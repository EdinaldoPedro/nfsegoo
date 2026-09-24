import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { fiscalError, requestFiscalDocument } from '@/app/services/fiscalNoteService';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const POST = withApiGuard(async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  if (!await checkRateLimit('reprocess_pdf_' + user.id, 10, 60_000)) return NextResponse.json({ error: 'Aguarde antes de agendar novos PDFs.' }, { status: 429 });
  try {
    const { id } = await params;
    const task = await prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { role: true } });
      if (!isSupportRole(actor.role)) fiscalError('Permissão revogada.', 403);
      const notes = await tx.notaFiscal.findMany({ where: { vendaId: id, status: { in: ['AUTORIZADA','CANCELADA'] }, arquivadoEm: null }, take: 2 });
      if (notes.length !== 1 || !(notes[0].xmlAutorizadoBase64 || notes[0].xmlBase64)) fiscalError('Uma única nota confirmada com XML original é necessária.');
      const note = notes[0];
      const document = await requestFiscalDocument(tx, note.id);
      await tx.systemLog.create({ data: { level: 'INFO', action: 'PDF_REBUILD_QUEUED', message: 'Regeneração de DANFSe agendada, sem alteração fiscal.', userId: user.id,
        empresaId: note.empresaId, vendaId: id, details: JSON.stringify({ notaId: note.id, documentTaskId: document.id }) } });
      return { id: document.id, notaId: document.notaId, status: document.status };
    });
    return NextResponse.json({ accepted: true, documentTask: task, message: 'DANFSe agendado. O PDF será salvo somente se a situação fiscal permanecer consistente.' }, { status: 202 });
  } catch (error) {
    const failure = error as Error & { status?: number };
    if (failure.status && failure.status < 500) return NextResponse.json({ error: failure.message }, { status: failure.status });
    throw error;
  }
});
