import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { validateRequest } from '@/app/utils/api-security';
import { hasCustomerCompanyAccess } from '@/app/utils/access-control';

export const dynamic = 'force-dynamic';

export const GET = withApiGuard(async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  const { id } = await params;
  return prisma.$transaction(async (tx) => {
    // Check ownership before loading customer data. Recovery never returns logs,
    // certificates, signed XML, PDFs or the raw fiscal-job payload.
    const sale = await tx.venda.findFirst({ where: { id, arquivadoEm: null }, select: { id: true, empresaId: true } });
    const user = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, empresaId: true, role: true } });
    if (!sale || !user || !await hasCustomerCompanyAccess(user, sale.empresaId, tx)) {
      return NextResponse.json({ error: 'Venda indisponível.' }, { status: 404 });
    }
    const contextId = request.headers.get('x-empresa-id');
    if (contextId && contextId !== sale.empresaId) {
      return NextResponse.json({ error: 'Selecione a empresa desta venda para recuperar os dados.' }, { status: 409 });
    }
    const venda = await tx.venda.findUniqueOrThrow({ where: { id }, select: {
      id: true, empresaId: true, clienteId: true, status: true, valor: true, descricao: true, createdAt: true,
      cliente: true,
      notas: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: {
        id: true, numero: true, numeroOficial: true, status: true, ambiente: true, cnae: true,
        dataEmissao: true, descricao: true, tomadorNome: true, codigoServico: true,
      } },
    } });
    const job = await tx.emissaoJob.findFirst({ where: { vendaId: id, empresaId: sale.empresaId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { payloadJson: true, ambiente: true, status: true } });
    let payload: Record<string, any> = {};
    if (job?.payloadJson && job.payloadJson.length <= 64 * 1024) {
      try {
        const parsed = JSON.parse(job.payloadJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed;
      } catch { /* Legacy records require explicit review, never guess fields from logs. */ }
    }
    return NextResponse.json({ ...venda,
      cnaeRecuperado: payload.codigoCnae || venda.notas[0]?.cnae || null,
      valorMoedaEstrangeira: payload.valorMoedaEstrangeira ?? null,
      issRetido: payload.issRetido ?? null, inssRetido: payload.retencoes?.inss?.retido ?? null,
      aliquota: payload.aliquota ?? null, dataCompetencia: payload.dataCompetencia ?? null,
      // A correction/copy must reserve a fresh DPS; the original number is not a suggestion.
      numeroDPS: null, serieDPS: null, ambienteOrigem: job?.ambiente || venda.notas[0]?.ambiente || null,
      recuperacaoParcial: !Object.keys(payload).length,
    }, { headers: { 'Cache-Control': 'no-store' } });
  });
});
