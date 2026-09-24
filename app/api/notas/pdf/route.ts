import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';
import { forbidden, getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { canOperateFiscalNote, requestFiscalDocument } from '@/app/services/fiscalNoteService';
import { prisma } from '@/app/utils/prisma';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const customerMode = request.headers.get('x-portal-mode') === 'customer';
  const { notaId } = await request.json();
  if (typeof notaId !== 'string' || !notaId || notaId.length > 100) return NextResponse.json({ error: 'Nota inválida.' }, { status: 400 });
  const metadata = await prisma.notaFiscal.findUnique({ where: { id: notaId }, select: { empresaId: true } });
  if (!metadata || !await canOperateFiscalNote(user, metadata.empresaId, 'CONSULTAR', prisma, customerMode)) return forbidden();
  if (!await checkRateLimit('note_pdf_' + user.id, 30, 60_000)) return NextResponse.json({ error: 'Aguarde antes de solicitar mais documentos.' }, { status: 429 });

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "NotaFiscal" WHERE "id" = ${notaId} FOR UPDATE`;
    const note = await tx.notaFiscal.findUniqueOrThrow({ where: { id: notaId }, include: { documentTask: true } });
    const actor = await tx.user.findUnique({ where: { id: user.id } });
    if (note.arquivadoEm || !actor || !await canOperateFiscalNote(actor, note.empresaId, 'CONSULTAR', tx, customerMode)) return { forbidden: true };
    if (!['AUTORIZADA', 'CANCELADA'].includes(note.status) || !note.chaveAcesso || !(note.xmlAutorizadoBase64 || note.xmlBase64)) return { error: 'Nota sem documento fiscal autorizado disponível.', status: 409 };
    // Legacy PDFs must be regenerated through the verified, compare-and-swap
    // document worker before being offered. Never render/save in this HTTP route.
    if (note.pdfBase64 && note.documentTask?.status === 'CONCLUIDA') return { pdf: note.pdfBase64, number: note.numeroOficial || String(note.numero || '') };
    if (note.documentTask?.status === 'REVISAO_MANUAL') return { error: 'Documento não disponível. Solicite ao suporte a verificação do XML e a regeneração do PDF.', status: 409 };
    if (!note.documentTask || note.documentTask.status === 'CONCLUIDA') await requestFiscalDocument(tx, note.id);
    return { error: 'PDF solicitado e ainda em preparação. Aguarde a conclusão no histórico e tente baixar novamente.', status: 202 };
  });
  if (result.forbidden) return forbidden();
  if (!result.pdf) return NextResponse.json({ error: result.error, pending: result.status === 202 }, { status: result.status || 409 });
  const compressed = Buffer.from(result.pdf, 'base64');
  const pdf = compressed[0] === 0x1f && compressed[1] === 0x8b ? gunzipSync(compressed, { maxOutputLength: 20 * 1024 * 1024 }) : compressed;
  if (pdf.length > 20 * 1024 * 1024 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') return NextResponse.json({ error: 'Documento inválido. Solicite uma nova geração ao suporte.' }, { status: 422 });
  return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="NFSe-${String(result.number).replace(/[^0-9]/g, '')}.pdf"`, 'Cache-Control': 'private, no-store' } });
});
