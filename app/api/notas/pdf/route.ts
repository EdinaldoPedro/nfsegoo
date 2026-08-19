import { NextResponse } from 'next/server';
import zlib from 'zlib';
import { generateDanfsePdf } from '@/app/services/pdf/DanfseGenerator';
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

    const xmlOficial = nota.xmlAutorizadoBase64 || nota.xmlBase64;
    if (!xmlOficial) {
      return NextResponse.json({ error: 'XML autorizado ausente para gerar o DANFSe.' }, { status: 400 });
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generateDanfsePdf(xmlOficial, {
        cancelada: nota.status === 'CANCELADA',
        eventoCancelamentoXml: nota.xmlCancelamentoEventoBase64,
      });
    } catch (error: any) {
      await createLog({
        level: 'ALERTA',
        action: 'FALHA_GERACAO_DANFSE_MANUAL',
        message: 'O usuario tentou baixar o DANFSe, mas o PDF nao pode ser gerado a partir do XML.',
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
        error: 'Nao foi possivel gerar o DANFSe a partir do XML autorizado.',
        details: error.message,
      }, { status: 422 });
    }

    const pdfGzip = zlib.gzipSync(pdfBuffer);
    const pdfBase64 = pdfGzip.toString('base64');

    await prisma.notaFiscal.update({
      where: { id: notaId },
      data: { pdfBase64 },
    });

    await createLog({
      level: 'INFO',
      action: 'DANFSE_GERADO_MANUAL',
      message: 'DANFSe gerado localmente a partir do XML autorizado.',
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
