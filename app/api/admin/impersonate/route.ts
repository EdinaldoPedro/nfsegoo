import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { checkIsStaff } from '@/app/utils/permissions';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { createLog } from '@/app/services/logger';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { getRequestIp } from '@/app/utils/request-ip';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { currentSessionId } from '@/app/utils/auth-session';
import {
  createImpersonationToken,
  getImpersonationExpiry,
  hashImpersonationToken,
  IMPERSONATION_COOKIE,
  revokeCurrentImpersonation,
} from '@/app/utils/impersonation';

export const POST = withApiGuard(async function POST(request: Request) {
  const actor = await getAuthenticatedUser(request);
  if (!actor) return unauthorized();
  if (!isSupportRole(actor.role)) return forbidden();
  const actorSessionId = await currentSessionId();
  if (!actorSessionId) return unauthorized();
  if (!(await checkRateLimit(`impersonate_${actor.id}`, 5, 5 * 60 * 1000))) return NextResponse.json({ error: 'Muitas tentativas. Aguarde 5 minutos.' }, { status: 429 });

  const sizeError = validateJsonContentLength(request, 32 * 1024);
  if (sizeError) return sizeError;

  try {
    const body = await request.json();
    const targetUserId = String(body.targetUserId || '').trim();
    const reason = String(body.reason || '').trim();
    const password = String(body.password || '');

    if (!targetUserId || reason.length < 10 || reason.length > 2000 || !password || Buffer.byteLength(password, 'utf8') > 72) {
      return NextResponse.json(
        { error: 'Usuario alvo, senha administrativa e justificativa de ao menos 10 caracteres sao obrigatorios.' },
        { status: 400 },
      );
    }

    if (targetUserId === actor.id) {
      return NextResponse.json({ error: 'Nao e permitido impersonar a propria conta.' }, { status: 400 });
    }

    const [actorWithPassword, target] = await Promise.all([
      prisma.user.findUnique({ where: { id: actor.id }, select: { senha: true } }),
      prisma.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, nome: true, email: true, role: true, empresaId: true },
      }),
    ]);

    if (!actorWithPassword || !(await bcrypt.compare(password, actorWithPassword.senha))) {
      await createLog({
        level: 'ALERTA',
        action: 'IMPERSONATION_REAUTH_FAILED',
        module: 'SEGURANCA',
        userId: actor.id,
        message: 'Falha de reautenticacao ao iniciar modo suporte.',
        details: { targetUserId },
      });
      return forbidden();
    }

    if (!target) {
      return NextResponse.json({ error: 'Usuario alvo nao encontrado.' }, { status: 404 });
    }

    if (checkIsStaff(target.role)) {
      return NextResponse.json({ error: 'Contas internas nao podem ser impersonadas.' }, { status: 403 });
    }

    await prisma.impersonationSession.updateMany({
      where: { actorUserId: actor.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const rawToken = createImpersonationToken();
    const expiresAt = getImpersonationExpiry();
    const session = await prisma.impersonationSession.create({
      data: {
        tokenHash: hashImpersonationToken(rawToken),
        actorUserId: actor.id,
        actorSessionId,
        targetUserId: target.id,
        mode: 'READ_ONLY',
        reason,
        ipAddress: getRequestIp(request),
        userAgent: String(request.headers.get('user-agent') || '').slice(0, 500) || null,
        expiresAt,
      },
    });

    await createLog({
      level: 'ALERTA',
      action: 'IMPERSONATION_STARTED',
      module: 'SEGURANCA',
      userId: actor.id,
      message: 'Modo suporte somente leitura iniciado.',
      details: { sessionId: session.id, targetUserId: target.id, reason, expiresAt },
    });

    const response = NextResponse.json({
      success: true,
      expiresAt,
      mode: 'READ_ONLY',
      fakeSession: target,
    });
    response.cookies.set({
      name: IMPERSONATION_COOKIE,
      value: rawToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      expires: expiresAt,
    });
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Erro interno ao iniciar modo suporte.' }, { status: 500 });
  }
}, { maxBodyBytes: 32 * 1024 });

export const DELETE = withApiGuard(async function DELETE(request: Request) {
  const actor = await getAuthenticatedUser(request);
  if (!actor) return unauthorized();

  await revokeCurrentImpersonation(actor.id);
  await createLog({
    level: 'INFO',
    action: 'IMPERSONATION_ENDED',
    module: 'SEGURANCA',
    userId: actor.id,
    message: 'Modo suporte encerrado.',
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: IMPERSONATION_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return response;
});
