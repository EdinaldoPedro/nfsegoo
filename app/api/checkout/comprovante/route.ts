import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { isCommercialRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { commercialTransaction, addOrderMessage, proofMetadataSelect } from '@/app/services/commercialService';
import { MANUAL_CONTRACTING_PAYMENT, MANUAL_CONTRACTING_PENDING_STATUSES, parsePedidoMetadata, validatePaymentProof } from '@/app/utils/manual-contracting';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const id = new URL(request.url).searchParams.get('id');
  if (!id || id.length > 120) return NextResponse.json({ error: 'Anexo inválido.' }, { status: 400 });
  const anexo = await prisma.pedidoAnexo.findFirst({ where: { id, pedido: {
    arquivadoEm: null, ...(isCommercialRole(user.role) ? {} : { userId: user.id }) } } });
  if (!anexo) return NextResponse.json({ error: 'Anexo não encontrado.' }, { status: 404 });
  await prisma.systemLog.create({ data: { level: 'INFO', action: 'COMPROVANTE_DOWNLOAD', userId: user.id,
    module: 'FINANCEIRO', message: 'Acesso a comprovante.', details: JSON.stringify({ pedidoId: anexo.pedidoId, anexoId: id }) } });
  return NextResponse.json({ id: anexo.id, nomeArquivo: anexo.nomeArquivo, mimeType: anexo.mimeType, tamanho: anexo.tamanho,
    conteudoBase64: `data:${anexo.mimeType};base64,${anexo.conteudoBase64}`, createdAt: anexo.createdAt });
});

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!await checkRateLimit(`proof:${user.id}`, 10, 15 * 60_000)) return NextResponse.json({ error: 'Muitos envios. Aguarde alguns minutos.' }, { status: 429 });
  const body = await request.json();
  if (typeof body.pedidoId !== 'string' || body.pedidoId.length > 120) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  const proof = validatePaymentProof(body);
  if (proof.errorResponse) return proof.errorResponse;
  try {
    const result = await commercialTransaction(user.id, async (tx) => {
      const pedido = await tx.pedido.findFirst({ where: { id: body.pedidoId, userId: user.id,
        formaPagamento: MANUAL_CONTRACTING_PAYMENT, arquivadoEm: null }, include: { _count: { select: { anexos: true } } } });
      if (!pedido) throw new CommercialError('Pedido não encontrado.', 404);
      if (!(MANUAL_CONTRACTING_PENDING_STATUSES as readonly string[]).includes(pedido.status) || (pedido.expiresAt && pedido.expiresAt <= new Date())) {
        throw new CommercialError('Pedido encerrado ou expirado. Não envie pagamento sem uma solicitação vigente.', 409);
      }
      if (!pedido.cotacaoHash) throw new CommercialError('Recrie o pedido legado antes de enviar pagamento.', 409);
      if (pedido._count.anexos >= 5) throw new CommercialError('Limite de cinco comprovantes por pedido atingido.', 409);
      const anexo = await tx.pedidoAnexo.create({ data: { pedidoId: pedido.id, userId: user.id, ...proof.value! }, select: proofMetadataSelect });
      // A new file must not roll an order back from EM_ANALISE.
      const status = pedido.status === 'EM_ANALISE' ? pedido.status : 'COMPROVANTE_ENVIADO';
      await tx.pedido.update({ where: { id: pedido.id }, data: { status, gatewayId: JSON.stringify({ ...parsePedidoMetadata(pedido.gatewayId), comprovanteEnviadoEm: new Date().toISOString() }) } });
      await addOrderMessage(tx, pedido, user.id, 'Comprovante enviado. O arquivo está disponível na contratação para conferência financeira.');
      await tx.systemLog.create({ data: { level: 'INFO', action: 'COMPROVANTE_CONTRATACAO_ENVIADO', userId: user.id,
        module: 'FINANCEIRO', message: 'Comprovante recebido.', details: JSON.stringify({ pedidoId: pedido.id, anexoId: anexo.id, tamanho: anexo.tamanho }) } });
      return { status, anexo: { ...anexo, downloadUrl: `/api/checkout/comprovante?id=${anexo.id}` } };
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}, { maxBodyBytes: 7 * 1024 * 1024 });
