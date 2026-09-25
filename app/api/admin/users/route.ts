import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { listAdminUsers } from '@/app/services/adminUserListService';
import { assertNoLegacyCompanyMutation } from '@/app/services/adminAccountCompanyService';
import { grantPlanManually } from '@/app/services/manualPlanGrantService';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { isLastMaster, requireAdminReauthentication, validateRoleTransition, updateUserRoleSecurely } from '@/app/utils/admin-security';

const STAFF_ROLES = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'];

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!STAFF_ROLES.includes(user.role)) return forbidden();

  try { return NextResponse.json(await listAdminUsers(user.id, new URL(request.url).searchParams)); }
  catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});

export const PUT = withApiGuard(async function PUT(request: Request) {
  const userAuth = await getAuthenticatedUser(request);
  if (!userAuth) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(userAuth.role)) return forbidden();

  try {
    const body = await request.json();
    assertNoLegacyCompanyMutation(body);
    if (Object.hasOwn(body, 'resetEmail')) return NextResponse.json({ error: 'A administração não substitui o e-mail de login. O titular deve confirmar o novo endereço em Minha conta.' }, { status: 409 });

    if (!body.id) {
      return NextResponse.json({ error: 'Usuario nao informado.' }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: String(body.id) } });
    if (!targetUser) {
      return NextResponse.json({ error: 'Usuario nao encontrado.' }, { status: 404 });
    }
    if (userAuth.role !== 'MASTER' && targetUser.role === 'MASTER') {
      return NextResponse.json({ error: 'Somente MASTER pode administrar uma conta MASTER.' }, { status: 403 });
    }

    const sensitiveAction = body.plano || body.role;
    if (sensitiveAction) {
      const errorResponse = await requireAdminReauthentication({
        actorId: userAuth.id,
        password: body.adminPassword,
        justification: body.justification,
        action: body.role ? 'CHANGE_USER_ROLE' : body.plano ? 'CHANGE_USER_PLAN' : 'CHANGE_USER_ACCOUNT',
      });
      if (errorResponse) return errorResponse;
    }

    if (body.role) {
      const roleError = validateRoleTransition({
        actorId: userAuth.id,
        actorRole: userAuth.role,
        targetId: targetUser.id,
        targetRole: targetUser.role,
        newRole: String(body.role),
      });
      if (roleError) return NextResponse.json({ error: roleError }, { status: 403 });

      if (body.role !== 'MASTER' && await isLastMaster(targetUser.id)) {
        return NextResponse.json({ error: 'O ultimo MASTER nao pode ser removido.' }, { status: 409 });
      }
    }


    if (body.plano) {
      if (body.pedidoId) return NextResponse.json({ error: 'Pedidos devem ser conciliados exclusivamente na área Contratações e pagamentos.' }, { status: 409 });
      const result = await grantPlanManually({ actorId: userAuth.id, userId: body.id, operationId: body.operationId,
        planSlug: body.plano, cycle: body.planoCiclo === 'AVULSO' ? 'MENSAL' : body.planoCiclo || 'MENSAL', justification: body.justification });
      return NextResponse.json(result);
    }

    if (body.role) {
      const result = await updateUserRoleSecurely(userAuth.id, targetUser.id, String(body.role), {}, body.justification);
      if (result.error) return result.error;
      return NextResponse.json({ success: true, message: 'Papel atualizado. Contratos e propriedade de empresas foram preservados.' });
    }
    return NextResponse.json({ error: 'Nenhuma operação reconhecida.' }, { status: 400 });
  } catch (e: any) {
    if (e instanceof CommercialError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
