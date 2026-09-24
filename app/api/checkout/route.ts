import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { createManualOrder, cancelManualOrder, orderInclude } from '@/app/services/commercialService';
import { MANUAL_CONTRACTING_PAYMENT, MANUAL_CONTRACTING_PENDING_STATUSES, serializePedidoContratacao, validatePaymentProof } from '@/app/utils/manual-contracting';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const pending = await prisma.pedido.findFirst({ where: { userId: user.id, formaPagamento: MANUAL_CONTRACTING_PAYMENT,
    status: { in: [...MANUAL_CONTRACTING_PENDING_STATUSES] }, arquivadoEm: null }, include: orderInclude, orderBy: { createdAt: 'desc' } });
  const historico = await prisma.pedido.findMany({ where: { userId: user.id, formaPagamento: MANUAL_CONTRACTING_PAYMENT, arquivadoEm: null },
    include: orderInclude, orderBy: { createdAt: 'desc' }, take: 20 });
  return NextResponse.json({ pedido: pending ? serializePedidoContratacao(pending) : null, historico: historico.map(serializePedidoContratacao) });
});

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!await checkRateLimit(`checkout:${user.id}`, 10, 15 * 60_000)) return NextResponse.json({ error: 'Muitas solicitações. Aguarde alguns minutos.' }, { status: 429 });
  const body = await request.json();
  const proof = body.comprovante ? validatePaymentProof(body.comprovante) : null;
  if (proof?.errorResponse) return proof.errorResponse;
  try {
    const result = await createManualOrder({ userId: user.id, input: body, hash: body.cotacaoHash,
      idempotencyKey: request.headers.get('Idempotency-Key'), proof: proof?.value });
    return NextResponse.json({ success: true, reused: result.reused, pedido: serializePedidoContratacao(result.pedido),
      mensagem: result.reused ? 'Solicitação já registrada.' : 'Solicitação registrada. Confira o prazo e acompanhe a conferência do pagamento.' }, { status: result.reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 7 * 1024 * 1024 });

export const DELETE = withApiGuard(async function DELETE(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const body = await request.json();
  if (typeof body.id !== 'string' || body.id.length > 120) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  try {
    const pedido = await cancelManualOrder(user.id, body.id);
    return NextResponse.json({ success: true, pedido: serializePedidoContratacao(pedido) });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
});
