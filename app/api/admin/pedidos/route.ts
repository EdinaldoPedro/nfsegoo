import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isCommercialRole } from '@/app/utils/access-control';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { prisma } from '@/app/utils/prisma';
import { orderInclude, processManualOrder } from '@/app/services/commercialService';
import { MANUAL_CONTRACTING_PAYMENT, MANUAL_CONTRACTING_PENDING_STATUSES, serializePedidoContratacao } from '@/app/utils/manual-contracting';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isCommercialRole(user.role)) return forbidden();
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(10000, Number(params.get('page')) || 1));
  if (!Number.isInteger(page)) return NextResponse.json({ error: 'Página inválida.' }, { status: 400 });
  const where: import('@prisma/client').Prisma.PedidoWhereInput = { formaPagamento: MANUAL_CONTRACTING_PAYMENT, arquivadoEm: null,
    ...(params.get('finalizados') !== '1' ? { status: { in: [...MANUAL_CONTRACTING_PENDING_STATUSES] } } : {}) };
  const [pedidos, total] = await Promise.all([
    prisma.pedido.findMany({ where, include: { ...orderInclude, user: { select: { id: true, nome: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 50, skip: (page - 1) * 50 }), prisma.pedido.count({ where }),
  ]);
  return NextResponse.json(pedidos.map((pedido) => ({ ...serializePedidoContratacao(pedido), user: pedido.user,
    temComprovante: pedido.anexos.length > 0, cotacaoLegada: !pedido.cotacaoHash })),
  { headers: { 'X-Total-Count': String(total), 'X-Page': String(page), 'X-Page-Size': '50' } });
});

export const PUT = withApiGuard(async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isCommercialRole(user.role)) return forbidden();
  const body = await request.json();
  if (typeof body.id !== 'string' || body.id.length > 120 || typeof body.status !== 'string') return NextResponse.json({ error: 'Pedido ou status inválido.' }, { status: 400 });
  const reauth = await requireAdminReauthentication({ actorId: user.id, password: body.adminPassword,
    justification: body.justification, action: 'PROCESS_MANUAL_ORDER' });
  if (reauth) return reauth;
  try {
    const pedido = await processManualOrder({ actorId: user.id, id: body.id, status: body.status, justification: body.justification,
      paymentReference: body.referenciaPagamento, receivedAmount: body.valorRecebido, paymentChecked: body.pagamentoConferido, reason: body.motivo });
    return NextResponse.json({ success: true, pedido: serializePedidoContratacao(pedido) });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});
