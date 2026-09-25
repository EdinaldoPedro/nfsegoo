import bcrypt from 'bcryptjs';
import type { Role, Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { createLog } from '@/app/services/logger';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const ASSIGNABLE_ROLES: Role[] = [
  'MASTER',
  'ADMIN',
  'SUPORTE_TI',
  'SUPORTE',
  'COMERCIAL',
  'CONTADOR',
  'COMUM',
];

export async function requireAdminReauthentication(params: {
  actorId: string;
  password?: unknown;
  justification?: unknown;
  action: string;
}) {
  const password = String(params.password || '');
  const justification = String(params.justification || '').trim();

  if (!password || Buffer.byteLength(password, 'utf8') > 72 || justification.length < 10 || justification.length > 2000) {
    return NextResponse.json(
      { error: 'Senha administrativa e justificativa de ao menos 10 caracteres sao obrigatorias.' },
      { status: 400 },
    );
  }
  if (!(await checkRateLimit(`admin_reauth_${params.actorId}`, 10, 5 * 60 * 1000))) {
    return NextResponse.json({ error: 'Muitas verificacoes de senha. Aguarde 5 minutos.' }, { status: 429 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: params.actorId },
    select: { senha: true },
  });
  const valid = actor ? await bcrypt.compare(password, actor.senha) : false;

  if (!valid) {
    await createLog({
      level: 'ALERTA',
      action: 'ADMIN_REAUTH_FAILED',
      module: 'SEGURANCA',
      userId: params.actorId,
      message: 'Falha de reautenticacao em operacao administrativa sensivel.',
      details: { attemptedAction: params.action },
    });
    return NextResponse.json({ error: 'Senha administrativa incorreta.' }, { status: 403 });
  }

  return null;
}

export function validateRoleTransition(params: {
  actorId: string;
  actorRole: Role;
  targetId: string;
  targetRole: Role;
  newRole: string;
}) {
  if (!['MASTER', 'ADMIN'].includes(params.actorRole)) return 'Papel sem permissao para gerenciar acessos.';
  if (!ASSIGNABLE_ROLES.includes(params.newRole as Role)) {
    return 'Papel de acesso invalido.';
  }

  if (params.actorRole !== 'MASTER') {
    if (params.targetRole === 'MASTER' || params.newRole === 'MASTER') {
      return 'Somente MASTER pode criar ou alterar uma conta MASTER.';
    }
  }

  if (params.actorId === params.targetId && params.newRole !== params.targetRole) {
    return 'Nao e permitido alterar o proprio papel de acesso.';
  }

  return null;
}

class RolePolicyError extends Error {}

/** Serializable isolation prevents two masters from concurrently removing each other. */
export async function updateUserRoleSecurely(actorId: string, targetId: string, newRole: string | undefined, data: Prisma.UserUpdateInput = {}, justification = 'Atualização administrativa de acesso') {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const user = await prisma.$transaction(async (tx) => {
        const [actor, target] = await Promise.all([
          tx.user.findUnique({ where: { id: actorId } }), tx.user.findUnique({ where: { id: targetId } }),
        ]);
        if (!actor || !target) throw new RolePolicyError('Usuario nao encontrado.');
        const resolvedRole = newRole ?? target.role;
        const policyError = validateRoleTransition({ actorId, actorRole: actor.role, targetId, targetRole: target.role, newRole: resolvedRole });
        if (policyError) throw new RolePolicyError(policyError);
        if (target.role === 'MASTER' && resolvedRole !== 'MASTER' && await tx.user.count({ where: { role: 'MASTER' } }) <= 1) {
          throw new RolePolicyError('O ultimo MASTER nao pode ser removido.');
        }
        const changed = target.role !== resolvedRole;
        const revokeSessions = changed || data.sessionVersion !== undefined;
        const updated = await tx.user.update({
          where: { id: targetId }, data: { ...data, role: resolvedRole as Role,
            ...(changed && target.role !== resolvedRole ? { customerPortalRevokedAt: new Date() } : {}),
            sessionVersion: revokeSessions ? { increment: 1 } : undefined },
        });
        if (revokeSessions) {
          await tx.authSession.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
          await tx.impersonationSession.updateMany({
            where: { OR: [{ actorUserId: targetId }, { targetUserId: targetId }], revokedAt: null }, data: { revokedAt: new Date() },
          });
        }
        await tx.systemLog.create({ data: { level: 'ALERTA', action: changed ? 'USER_ROLE_CHANGED' : 'USER_ACCOUNT_UPDATED_BY_ADMIN',
          module: 'SEGURANCA', userId: actorId, message: 'Acesso/cadastro atualizado sem alteração de contrato ou propriedade.',
          details: JSON.stringify({ targetUserId: targetId, previousRole: target.role, newRole: resolvedRole,
            fields: Object.keys(data).filter((key) => key !== 'sessionVersion'), justification }) } });
        return updated;
      }, { isolationLevel: 'Serializable' });
      return { user, error: null };
    } catch (cause) {
      if (cause instanceof RolePolicyError) return { user: null, error: NextResponse.json({ error: cause.message }, { status: 403 }) };
      if ((cause as { code?: string })?.code === 'P2034' && attempt < 2) continue;
      throw cause;
    }
  }
  return { user: null, error: NextResponse.json({ error: 'Conflito de concorrencia. Tente novamente.' }, { status: 409 }) };
}

export async function isLastMaster(userId: string) {
  const [target, masters] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.user.count({ where: { role: 'MASTER' } }),
  ]);
  return target?.role === 'MASTER' && masters <= 1;
}
