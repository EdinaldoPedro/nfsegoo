import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { validateRequest } from '@/app/utils/api-security';
import { hasCustomerCompanyAccess } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { criarEmissaoJob } from '@/app/services/emissaoJobService';
import { validateSelectableNbs } from '@/app/utils/nbs';

export const POST = withApiGuard(async function POST(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || !targetId) return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });
  const { vendaId, dadosAtualizados = {} } = await request.json();
  if (typeof vendaId !== 'string' || !dadosAtualizados || typeof dadosAtualizados !== 'object' || Array.isArray(dadosAtualizados)) {
    return NextResponse.json({ error: 'Dados de reenvio inválidos.' }, { status: 400 });
  }
  const venda = await prisma.venda.findUnique({ where: { id: vendaId } });
  if (!venda || !await hasCustomerCompanyAccess(user, venda.empresaId)) return NextResponse.json({ error: 'Venda indisponível.' }, { status: 404 });
  const previous = await prisma.emissaoJob.findFirst({ where: { vendaId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { payloadJson: true } });
  const original = previous ? JSON.parse(previous.payloadJson) : {};
  const payload = { ...original, ...dadosAtualizados, vendaId, clienteId: venda.clienteId,
    valor: dadosAtualizados.valor ?? original.valor ?? String(venda.valor), descricao: dadosAtualizados.descricao ?? original.descricao ?? venda.descricao,
    numeroDPS: dadosAtualizados.numeroDPS, copiaDeVendaId: undefined, idempotencyKey: undefined,
    // A previous attempt's confirmation does not authorize this new attempt.
    empresaConfirmadaId: dadosAtualizados.empresaConfirmadaId, ambienteConfirmado: dadosAtualizados.ambienteConfirmado };
  if (payload.codigoNbs !== undefined) {
    const validation = await validateSelectableNbs(payload.codigoNbs);
    if (validation.error) return NextResponse.json({ error: validation.error }, { status: 400 });
    payload.codigoNbs = validation.code;
  }
  try {
    const { job } = await criarEmissaoJob({ userId: targetId, contextId: venda.empresaId, body: payload,
      idempotencyKey: request.headers.get('x-idempotency-key'), source: 'USER_RETRY' });
    return NextResponse.json({ success: true, async: true, emissaoJobId: job.id, vendaId: job.vendaId, status: job.status }, { status: 202 });
  } catch (error: any) {
    if (!error.status || error.status >= 500) throw error;
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
}, { maxBodyBytes: 32 * 1024 });
