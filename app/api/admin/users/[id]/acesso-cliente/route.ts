import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { INTERNAL_CUSTOMER_GRANT_ROLES, internalCustomerGrantActive, isAdminRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

type Context = { params: Promise<{ id: string }> };

export const GET = withApiGuard(async function GET(request: Request, { params }: Context) {
  const actor = await getAuthenticatedUser(request);
  if (!actor) return unauthorized();
  if (!isAdminRole(actor.role)) return forbidden();
  const target = await prisma.user.findUnique({ where: { id: (await params).id }, select: {
    id: true, role: true, customerPortalGrantedAt: true, customerPortalGrantedById: true, customerPortalRevokedAt: true,
  } });
  if (!target) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });
  return NextResponse.json({ userId: target.id, role: target.role, eligible: INTERNAL_CUSTOMER_GRANT_ROLES.includes(target.role),
    enabled: internalCustomerGrantActive(target), grantedAt: target.customerPortalGrantedAt,
    revokedAt: target.customerPortalRevokedAt, grantedById: target.customerPortalGrantedById },
  { headers: { 'Cache-Control': 'no-store, private' } });
});

export const POST = withApiGuard(async function POST(request: Request, { params }: Context) {
  const actor = await getAuthenticatedUser(request);
  if (!actor) return unauthorized();
  if (!isAdminRole(actor.role)) return forbidden();
  const targetId = (await params).id;
  if (actor.id === targetId) return NextResponse.json({ error: 'Não é permitido conceder ou revogar o próprio acesso.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || (body.action !== 'GRANT' && body.action !== 'REVOKE')) return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  const denied = await requireAdminReauthentication({ actorId: actor.id, password: body.adminPassword,
    justification: body.justification, action: `INTERNAL_CUSTOMER_${body.action}` });
  if (denied) return denied;

  const result = await prisma.$transaction(async tx => {
    for (const id of [actor.id, targetId].sort()) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
    const [currentActor, target] = await Promise.all([
      tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }),
      tx.user.findUnique({ where: { id: targetId }, select: { role: true, customerPortalGrantedAt: true, customerPortalRevokedAt: true } }),
    ]);
    if (!isAdminRole(currentActor?.role)) return { error: 'Permissão administrativa revogada.', status: 403 };
    if (!target) return { error: 'Conta não encontrada.', status: 404 };
    if (!INTERNAL_CUSTOMER_GRANT_ROLES.includes(target.role)) return { error: 'Este perfil não recebe concessão de área do cliente.', status: 409 };
    const active = internalCustomerGrantActive(target);
    if (active === (body.action === 'GRANT')) return { success: true, changed: false, enabled: active };
    const now = new Date();
    await tx.user.update({ where: { id: targetId }, data: body.action === 'GRANT'
      ? { customerPortalGrantedAt: now, customerPortalGrantedById: actor.id, customerPortalRevokedAt: null }
      : { customerPortalRevokedAt: now } });
    await tx.systemLog.create({ data: { level: 'ALERTA', action: body.action === 'GRANT' ? 'INTERNAL_CUSTOMER_ACCESS_GRANTED' : 'INTERNAL_CUSTOMER_ACCESS_REVOKED',
      module: 'SEGURANCA', userId: actor.id, message: 'Acesso de colaborador interno à área do cliente alterado.',
      details: JSON.stringify({ targetUserId: targetId, action: body.action, justification: String(body.justification).trim() }) } });
    return { success: true, changed: true, enabled: body.action === 'GRANT' };
  });
  return 'error' in result ? NextResponse.json({ error: result.error }, { status: result.status })
    : NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, private' } });
}, { maxBodyBytes: 16 * 1024 });
