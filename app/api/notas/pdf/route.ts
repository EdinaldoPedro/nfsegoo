import { NextResponse } from 'next/server';
import zlib from 'zlib';
import { NfsePortalDownloader } from '@/app/services/pdf/NfsePortalDownloader';
import { createLog } from '@/app/services/logger';
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
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await downloader.downloadPdfOficialComRetry(
        nota.chaveAcesso,
        empresa.certificadoA1,
        empresa.senhaCertificado,
        empresa.id,
        {
          attempts: 3,
          retryDelayMs: 1500,
          navigationTimeoutMs: 30000,
          authTimeoutMs: 20000,
          actionTimeoutMs: 6000,
          downloadTimeoutMs: 30000,
          downloadNavigationTimeoutMs: 15000,
        },
      );
    } catch (error: any) {
      await createLog({
        level: 'ALERTA',
        action: 'FALHA_BOT_PDF_MANUAL',
        message: 'O usuario tentou baixar o PDF, mas o robo nao conseguiu capturar o arquivo.',
        details: {
          erro: error.message,
          origem: 'menu_cliente',
          notaId: nota.id,
          numeroNota: nota.numero,
        },
        empresaId: nota.empresaId,
        vendaId: nota.vendaId || undefined,
      });

      return NextResponse.json({
        error: 'O Portal Nacional esta instavel e nao entregou o PDF agora. Tente baixar novamente em alguns instantes.',
        details: error.message,
      }, { status: 504 });
    }

    const pdfGzip = zlib.gzipSync(pdfBuffer);
    const pdfBase64 = pdfGzip.toString('base64');

    await prisma.notaFiscal.update({
      where: { id: notaId },
      data: { pdfBase64 },
    });

    await createLog({
      level: 'INFO',
      action: 'PDF_CAPTURADO_MANUAL',
      message: 'PDF Oficial capturado por tentativa manual do usuario.',
      details: { notaId: nota.id, numeroNota: nota.numero },
      empresaId: nota.empresaId,
      vendaId: nota.vendaId || undefined,
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
