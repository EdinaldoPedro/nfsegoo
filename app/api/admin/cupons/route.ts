import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isAdminRole } from '@/app/utils/access-control';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { validateCatalogCoupon } from '@/app/utils/commercial-catalog';
import { prisma } from '@/app/utils/prisma';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role)) return forbidden();
  const page = Number(new URL(request.url).searchParams.get('page') || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return NextResponse.json({ error: 'Página inválida.' }, { status: 400 });
  const [cupons, total] = await Promise.all([
    prisma.cupom.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 50, skip: (page - 1) * 50, include: {
      _count: { select: { logs: true } }, logs: { take: 20, orderBy: { createdAt: 'desc' }, include: {
        user: { select: { nome: true, email: true } }, fatura: { select: { id: true, status: true, valorTotal: true } },
      } },
    } }), prisma.cupom.count(),
  ]);
  return NextResponse.json(cupons, { headers: { 'X-Total-Count': String(total), 'X-Page-Size': '50' } });
});

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role)) return forbidden();
  const body = await request.json();
  const authError = await requireAdminReauthentication({ actorId: user.id, password: body.adminPassword, justification: body.justification, action: 'CREATE_COUPON' });
  if (authError) return authError;
  try {
    const data = validateCatalogCoupon(body);
    const cupom = await prisma.$transaction(async (tx) => {
      const ids = data.planosValidos?.split(',') || [];
      if (ids.length && await tx.plan.count({ where: { id: { in: ids } } }) !== ids.length) throw new CommercialError('Produto elegível não encontrado.');
      const created = await tx.cupom.create({ data });
      await tx.systemLog.create({ data: { level: 'INFO', module: 'FINANCEIRO', action: 'CREATE_COUPON', userId: user.id,
        message: 'Cupom criado.', details: JSON.stringify({ cupomId: created.id, rules: data, justification: body.justification }) } });
      return created;
    });
    return NextResponse.json(cupom, { status: 201 });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    if ((error as { code?: string }).code === 'P2002') return NextResponse.json({ error: 'Código já utilizado. Crie outro para preservar o histórico.' }, { status: 409 });
    throw error;
  }
});

export const DELETE = withApiGuard(async function DELETE(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role)) return forbidden();
  const body = await request.json();
  if (typeof body.id !== 'string' || body.id.length > 120) return NextResponse.json({ error: 'Cupom inválido.' }, { status: 400 });
  const authError = await requireAdminReauthentication({ actorId: user.id, password: body.adminPassword, justification: body.justification, action: 'DISABLE_COUPON' });
  if (authError) return authError;
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.cupom.updateMany({ where: { id: body.id }, data: { ativo: false } });
    if (updated.count) await tx.systemLog.create({ data: { level: 'INFO', module: 'FINANCEIRO', action: 'DISABLE_COUPON', userId: user.id,
      message: 'Cupom desativado para novas cotações; reservas vigentes preservadas.', details: JSON.stringify({ cupomId: body.id, justification: body.justification }) } });
    return updated.count;
  });
  return NextResponse.json(result ? { success: true, message: 'Cupom desativado. Histórico preservado.' } : { error: 'Cupom não encontrado.' }, { status: result ? 200 : 404 });
});
