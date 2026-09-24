import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { validateRequest } from '@/app/utils/api-security';
import { hasCustomerCompanyAccess } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { enqueueFiscalNoteOperation, fiscalError } from '@/app/services/fiscalNoteService';
import { archiveSale } from '@/app/services/saleArchiveService';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const POST = withApiGuard(async function POST(request: Request) {
  const { user, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user) return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 });
  const body = await request.json();
  if (typeof body.vendaId !== 'string' || body.vendaId.length > 100) return NextResponse.json({ error: 'Venda inválida.' }, { status: 400 });
  try {
    const sale = await prisma.venda.findUnique({ where: { id: body.vendaId }, select: { id: true, empresaId: true } });
    if (!sale || !await hasCustomerCompanyAccess(user, sale.empresaId)) fiscalError('Venda não disponível.', 403);
    if (body.acao === 'CANCELAR') {
      if (!await checkRateLimit('cancel_note_' + user.id, 10, 60_000)) return NextResponse.json({ error: 'Aguarde antes de enviar novas solicitações.' }, { status: 429 });
      const notes = await prisma.notaFiscal.findMany({ where: { vendaId: sale.id, empresaId: sale.empresaId, chaveAcesso: { not: null }, arquivadoEm: null }, select: { id: true }, take: 2 });
      if (notes.length !== 1) fiscalError('A venda precisa ter uma única nota identificada para esta operação.');
      const operation = await enqueueFiscalNoteOperation({ actorId: user.id, notaId: notes[0].id, tipo: 'CANCELAR',
        idempotencyKey: body.idempotencyKey, reasonCode: body.reasonCode, justification: body.justification });
      return NextResponse.json({ accepted: true, operation, message: 'Solicitação registrada. O cancelamento ainda depende de confirmação fiscal.' }, { status: 202 });
    }
    if (body.acao === 'EXCLUIR_VENDA') {
      await archiveSale(user.id, sale.id);
      return NextResponse.json({ success: true, message: 'Venda arquivada no histórico.' });
    }
    if (body.acao === 'CORRIGIR') return NextResponse.json({ error: 'Revise a venda no formulário de emissão. Esta ação não altera mais a situação fiscal.' }, { status: 410 });
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    const failure = error as Error & { status?: number };
    if (failure.status && failure.status < 500) return NextResponse.json({ error: failure.message }, { status: failure.status });
    throw error;
  }
});
