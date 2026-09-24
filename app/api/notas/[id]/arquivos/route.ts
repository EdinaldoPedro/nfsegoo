import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { canOperateFiscalNote } from '@/app/services/fiscalNoteService';
import { fiscalDocumentDownload } from '@/app/services/fiscalDocumentDownload';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const GET = withApiGuard(async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const customerMode = request.headers.get('x-portal-mode') === 'customer';
  const { id } = await params;
  const metadata = await prisma.notaFiscal.findUnique({ where: { id }, select: { empresaId: true, arquivadoEm: true } });
  if (!metadata || metadata.arquivadoEm || !await canOperateFiscalNote(user, metadata.empresaId, 'CONSULTAR', prisma, customerMode)) return forbidden();
  if (!await checkRateLimit('note_xml_' + user.id, 30, 60_000)) return NextResponse.json({ error: 'Aguarde antes de baixar mais arquivos.' }, { status: 429 });
  const note = await prisma.notaFiscal.findFirst({ where: { id, empresaId: metadata.empresaId, arquivadoEm: null }, select: {
    numero: true, numeroOficial: true, xmlBase64: true, xmlAutorizadoBase64: true, xmlCancelamentoEventoBase64: true,
  } });
  if (!note) return forbidden();
  return fiscalDocumentDownload(note);
});
