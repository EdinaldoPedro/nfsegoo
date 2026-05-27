import { NextResponse } from 'next/server';
import zlib from 'zlib';
import { NfsePortalDownloader } from '@/app/services/pdf/NfsePortalDownloader';
import { forbidden, getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { hasEmpresaAccess } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  try {
    const { notaId } = await request.json();

    const nota = await prisma.notaFiscal.findUnique({
      where: { id: notaId },
      include: { empresa: true },
    });

    if (!nota || !nota.chaveAcesso) {
      return NextResponse.json({ error: 'Nota invÃ¡lida ou sem chave.' }, { status: 400 });
    }

    const hasAccess = await hasEmpresaAccess(user, nota.empresaId);
    if (!hasAccess) return forbidden();

    if (nota.pdfBase64) {
      const bufferBanco = Buffer.from(nota.pdfBase64, 'base64');
      const isGzip = bufferBanco[0] === 0x1f && bufferBanco[1] === 0x8b;
      const pdfFinal = isGzip ? zlib.gunzipSync(bufferBanco) : bufferBanco;

      return new NextResponse(pdfFinal as any, {
        headers: { 'Content-Type': 'application/pdf' },
      });
    }

    const empresa = nota.empresa;
    if (!empresa.certificadoA1 || !empresa.senhaCertificado) {
      return NextResponse.json({ error: 'Empresa sem certificado digital configurado.' }, { status: 400 });
    }

    const downloader = new NfsePortalDownloader();
    const pdfBuffer = await downloader.downloadPdfOficial(
      nota.chaveAcesso,
      empresa.certificadoA1,
      empresa.senhaCertificado,
      empresa.id,
    );

    const pdfGzip = zlib.gzipSync(pdfBuffer);
    const pdfBase64 = pdfGzip.toString('base64');

    await prisma.notaFiscal.update({
      where: { id: notaId },
      data: { pdfBase64 },
    });

    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="NFSe-${nota.numero}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
  } catch (error: any) {
    console.error('[ERRO PDF]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
