import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { fiscalDocumentDownload } from '@/app/services/fiscalDocumentDownload';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const GET = withApiGuard(async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  if (!await checkRateLimit('note_xml_' + user.id, 30, 60_000)) return NextResponse.json({ error: 'Aguarde antes de baixar mais arquivos.' }, { status: 429 });
  const { id } = await params;
  const note = await prisma.notaFiscal.findFirst({ where: { vendaId: id, arquivadoEm: null, chaveAcesso: { not: null } },
    orderBy: { createdAt: 'desc' }, select: {
      numero: true, numeroOficial: true, xmlBase64: true, xmlAutorizadoBase64: true, xmlCancelamentoEventoBase64: true,
    } });
  if (!note) return NextResponse.json({ error: 'Documento fiscal não disponível.' }, { status: 404 });
  return fiscalDocumentDownload(note);
});
