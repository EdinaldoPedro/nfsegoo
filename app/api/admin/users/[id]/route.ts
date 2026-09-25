import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden } from '@/app/utils/api-middleware';
import { stripUserSecrets } from '@/app/utils/safe-data';
import { assertNoLegacyCompanyMutation } from '@/app/services/adminAccountCompanyService';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { prisma } from '@/app/utils/prisma';
import { isLastMaster, requireAdminReauthentication, validateRoleTransition, updateUserRoleSecurely } from '@/app/utils/admin-security';
import { validateJsonContentLength } from '@/app/utils/request-guards';
import { getEffectivePlanLimits } from '@/app/services/planService';


export const GET = withApiGuard(async function GET(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const admin = await getAuthenticatedUser(request);
  if (!admin || !['MASTER', 'ADMIN'].includes(admin.role)) return forbidden();

  try {
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true, nome: true, email: true, telefone: true, role: true, empresaId: true,
        createdAt: true, updatedAt: true, limiteEmpresas: true, empresasAdicionais: true,
        plano: true, planoCiclo: true, planoStatus: true,
        empresa: { select: { id: true, documento: true, razaoSocial: true, ambiente: true, arquivadoEm: true } },
        empresasContabeis: {
          where: { status: 'APROVADO', arquivadoEm: null, empresa: { arquivadoEm: null } },
          take: 50, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          select: { id: true, status: true, empresa: { select: { id: true, documento: true, razaoSocial: true } } },
        },
        _count: { select: { empresasContabeis: { where: { status: 'APROVADO', arquivadoEm: null, empresa: { arquivadoEm: null } } } } },
        historicoPlanos: {
          include: { plan: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 5,
        },
      },
    });

    if (!user) return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 });

    const { historicoPlanos, ...safeUser } = user;
    return NextResponse.json({ ...safeUser, status: safeUser.planoStatus, planHistories: historicoPlanos, limits: await getEffectivePlanLimits(user.id) });
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar' }, { status: 500 });
  }
});

export const PATCH = withApiGuard(async function PATCH(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const admin = await getAuthenticatedUser(request);
  if (!admin || !['MASTER', 'ADMIN'].includes(admin.role)) return forbidden();

  try {
    const sizeError = validateJsonContentLength(request, 64 * 1024);
    if (sizeError) return sizeError;
    const body = await request.json();
    assertNoLegacyCompanyMutation(body);
    const {
      limiteEmpresas,
      role,
    } = body;

    if (['limiteNotas', 'limiteClientes', 'assinaturaAtiva', 'renovacaoAutomatica', 'aplicarPlanoPadrao', 'plano'].some((key) => body[key] !== undefined)) {
      return NextResponse.json({ error: 'Use a ação Conceder benefício para contratos. Salvar acesso não altera assinatura.' }, { status: 409 });
    }

    const userAtual = await prisma.user.findUnique({ where: { id: params.id } });
    if (!userAtual) return NextResponse.json({ error: 'Usuario nao encontrado' }, { status: 404 });
    if (admin.role !== 'MASTER' && userAtual.role === 'MASTER') return forbidden();

    const reauthError = await requireAdminReauthentication({
      actorId: admin.id,
      password: body.adminPassword,
      justification: body.justification,
      action: 'UPDATE_ADMINISTRATIVE_USER',
    });
    if (reauthError) return reauthError;

    if (role) {
      const roleError = validateRoleTransition({
        actorId: admin.id,
        actorRole: admin.role,
        targetId: userAtual.id,
        targetRole: userAtual.role,
        newRole: String(role),
      });
      if (roleError) return NextResponse.json({ error: roleError }, { status: 403 });
      if (role !== 'MASTER' && await isLastMaster(userAtual.id)) {
        return NextResponse.json({ error: 'O ultimo MASTER nao pode ser removido.' }, { status: 409 });
      }
    }

    const data: Record<string, unknown> = {};
    if (limiteEmpresas !== undefined) {
      if (typeof limiteEmpresas !== 'number' || !Number.isInteger(limiteEmpresas) || limiteEmpresas < 0 || limiteEmpresas > 10_000) {
        return NextResponse.json({ error: 'Limite de empresas deve ser um inteiro entre 0 e 10.000.' }, { status: 400 });
      }
      data.limiteEmpresas = limiteEmpresas;
    }
    const result = await updateUserRoleSecurely(admin.id, params.id, role === undefined ? undefined : String(role), data, body.justification);
    if (result.error) return result.error;
    return NextResponse.json(stripUserSecrets(result.user));
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}, { maxBodyBytes: 64 * 1024 });

export const PUT = withApiGuard(async function PUT(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const admin = await getAuthenticatedUser(request);
  if (!admin || !['MASTER', 'ADMIN'].includes(admin.role)) return forbidden();

  try {
    const sizeError = validateJsonContentLength(request, 64 * 1024);
    if (sizeError) return sizeError;
    const body = await request.json();

    assertNoLegacyCompanyMutation(body);
    if (Object.hasOwn(body, 'email')) return NextResponse.json({ error: 'O e-mail de login só pode ser alterado pelo titular após confirmação do novo endereço.' }, { status: 409 });
    const targetUser = await prisma.user.findUnique({ where: { id: params.id } });
    if (!targetUser) return NextResponse.json({ error: 'Usuario nao encontrado.' }, { status: 404 });
    if (admin.role !== 'MASTER' && targetUser.role === 'MASTER') return forbidden();

    const reauthError = await requireAdminReauthentication({
      actorId: admin.id,
      password: body.adminPassword,
      justification: body.justification,
      action: 'UPDATE_USER_ACCOUNT',
    });
    if (reauthError) return reauthError;

    if (body.role !== undefined) {
      const roleError = validateRoleTransition({
        actorId: admin.id,
        actorRole: admin.role,
        targetId: targetUser.id,
        targetRole: targetUser.role,
        newRole: String(body.role),
      });
      if (roleError) return NextResponse.json({ error: roleError }, { status: 403 });
      if (body.role !== 'MASTER' && await isLastMaster(targetUser.id)) {
        return NextResponse.json({ error: 'O ultimo MASTER nao pode ser removido.' }, { status: 409 });
      }
    }

    const dataToUpdate: Record<string, unknown> = {};
    if (body.nome !== undefined) {
      if (typeof body.nome !== 'string' || body.nome.trim().length < 2 || body.nome.length > 160 || Array.from(body.nome as string).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return NextResponse.json({ error: 'Nome inválido (entre 2 e 160 caracteres).' }, { status: 400 });
      dataToUpdate.nome = body.nome.trim();
    }
    if (body.role !== undefined) dataToUpdate.role = body.role;

    if (body.plano !== undefined) {
      return NextResponse.json({ error: 'Use a concessão administrativa de benefício; esta rota não altera contratos.' }, { status: 409 });
    }
    const result = await updateUserRoleSecurely(admin.id, params.id, body.role === undefined ? undefined : String(body.role), dataToUpdate, body.justification);
    if (result.error) return result.error;
    return NextResponse.json(stripUserSecrets(result.user));
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Erro ao atualizar' }, { status: 500 });
  }
}, { maxBodyBytes: 64 * 1024 });
