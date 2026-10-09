import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isAdminRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { inspecionarEmissaoVenda } from '@/app/services/emissao/EmissionInspector';
import { criarEmissaoJob } from '@/app/services/emissaoJobService';
import { validateSelectableNbs } from '@/app/utils/nbs';

export const POST = withApiGuard(async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role)) return forbidden();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
  if (justification.length < 10 || justification.length > 2000 || !body.overrides || typeof body.overrides !== 'object' || Array.isArray(body.overrides)) {
    return NextResponse.json({ error: 'Informe os dados corrigidos e uma justificativa entre 10 e 2000 caracteres.' }, { status: 400 });
  }
  const sale = await prisma.venda.findFirst({ where: { id, arquivadoEm: null }, select: {
    id: true, empresaId: true, clienteId: true, status: true, empresa: { select: { ambiente: true } },
  } });
  if (!sale) return NextResponse.json({ error: 'Venda não encontrada.' }, { status: 404 });
  if (sale.status !== 'ERRO_EMISSAO') return NextResponse.json({ error: 'Somente vendas com falha de emissão podem ser reenviadas pela bancada.' }, { status: 409 });
  const confirmationText = sale.empresa.ambiente === 'PRODUCAO' ? 'EMITIR NFSE' : 'EMITIR TESTE';
  if (body.confirmation !== confirmationText) return NextResponse.json({ error: `Digite ${confirmationText} para confirmar.` }, { status: 400 });
  if (!await checkRateLimit(`admin_correction_emission_${user.id}`, 10, 5 * 60 * 1000)) {
    return NextResponse.json({ error: 'Muitas tentativas administrativas. Aguarde 5 minutos.' }, { status: 429 });
  }
  if (sale.empresa.ambiente === 'PRODUCAO') {
    const reauth = await requireAdminReauthentication({ actorId: user.id, password: body.adminPassword, justification, action: 'ADMIN_CORRECTION_PRODUCTION_EMISSION' });
    if (reauth) return reauth;
  }
  const nbs = await validateSelectableNbs(body.overrides.codigoNbs);
  if (nbs.error) return NextResponse.json({ error: nbs.error }, { status: 400 });
  const overrides = { ...body.overrides, codigoNbs: nbs.code };
  const inspection = await inspecionarEmissaoVenda(id, overrides);
  if (inspection.resumo.status === 'BLOQUEADO') {
    return NextResponse.json({ error: 'A validação encontrou bloqueios. Corrija os campos indicados antes de emitir.', inspection }, { status: 422 });
  }
  try {
    const result = await criarEmissaoJob({
      userId: user.id,
      contextId: sale.empresaId,
      idempotencyKey: randomUUID(),
      source: 'ADMIN_CORRECTION',
      administrativeCorrection: { empresaId: sale.empresaId, sourceSaleId: sale.id, justification },
      body: { ...overrides, vendaId: sale.id, clienteId: sale.clienteId, empresaConfirmadaId: sale.empresaId, ambienteConfirmado: sale.empresa.ambiente,
        numeroDPS: undefined },
    });
    return NextResponse.json({ accepted: true, jobId: result.job.id, vendaId: sale.id, ambiente: sale.empresa.ambiente,
      message: sale.empresa.ambiente === 'PRODUCAO' ? 'Correção validada e NFS-e enviada para processamento.' : 'Correção validada e teste enviado para processamento.' }, { status: 202 });
  } catch (error) {
    const failure = error as Error & { status?: number; code?: string };
    if (failure.status && failure.status < 500) return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
    throw error;
  }
});
