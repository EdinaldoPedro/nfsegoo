import { NextResponse } from 'next/server';
import zlib from 'zlib';
import { NfsePortalDownloader } from '@/app/services/pdf/NfsePortalDownloader';
import { createLog } from '@/app/services/logger';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

async function ensureSupport(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  return null;
}

function temXmlOficial(nota: any) {
  return Boolean(nota.xmlAutorizadoBase64 || nota.xmlBase64);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  try {
    const venda = await prisma.venda.findUnique({
      where: { id: params.id },
      include: {
        empresa: true,
        notas: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!venda) {
      return NextResponse.json({ error: 'Venda nao encontrada.' }, { status: 404 });
    }

    const nota = venda.notas.find((item) => item.status === 'AUTORIZADA') || venda.notas[0];
    if (!nota) {
      return NextResponse.json({ error: 'Venda sem nota fiscal para reprocessar.' }, { status: 400 });
    }

    if (!nota.chaveAcesso) {
      return NextResponse.json({ error: 'A nota ainda nao tem chave de acesso.' }, { status: 400 });
    }

    if (!temXmlOficial(nota)) {
      return NextResponse.json({ error: 'XML oficial ausente. Reprocesse o XML antes de atualizar o PDF.' }, { status: 400 });
    }

    if (nota.pdfBase64) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: 'PDF ja esta salvo no banco.',
      });
    }

    if (!venda.empresa.certificadoA1 || !venda.empresa.senhaCertificado) {
      return NextResponse.json({ error: 'Empresa sem certificado digital configurado.' }, { status: 400 });
    }

    await createLog({
      level: 'INFO',
      action: 'REPROCESSAMENTO_PDF_INICIADO',
      message: 'Reprocessamento manual do PDF iniciado pela bancada admin.',
      details: {
        notaId: nota.id,
        numeroNota: nota.numero,
        chaveAcesso: nota.chaveAcesso,
      },
      empresaId: venda.empresaId,
      vendaId: venda.id,
    });

    const downloader = new NfsePortalDownloader();
    const pdfBuffer = await downloader.downloadPdfOficialComRetry(
      nota.chaveAcesso,
      venda.empresa.certificadoA1,
      venda.empresa.senhaCertificado,
      venda.empresa.id,
      {
        attempts: 10,
        retryDelayMs: 2000,
        requestTimeoutMs: 40000,
      },
    );

    const pdfBase64 = zlib.gzipSync(pdfBuffer).toString('base64');
    await prisma.notaFiscal.update({
      where: { id: nota.id },
      data: { pdfBase64 },
    });

    await createLog({
      level: 'INFO',
      action: 'PDF_CAPTURADO_REPROCESSAMENTO',
      message: 'PDF Oficial salvo por reprocessamento manual da bancada.',
      details: {
        notaId: nota.id,
        numeroNota: nota.numero,
        tamanhoBytes: pdfBuffer.length,
      },
      empresaId: venda.empresaId,
      vendaId: venda.id,
    });

    return NextResponse.json({
      success: true,
      message: 'PDF reprocessado e salvo com sucesso.',
      notaId: nota.id,
      tamanhoBytes: pdfBuffer.length,
    });
  } catch (error: any) {
    await createLog({
      level: 'ALERTA',
      action: 'FALHA_BOT_PDF_REPROCESSAMENTO',
      message: 'O robo nao conseguiu baixar o PDF no reprocessamento manual.',
      details: {
        erro: error.message,
        vendaId: params.id,
      },
      vendaId: params.id,
    });

    return NextResponse.json({
      error: 'O Portal Nacional nao entregou o PDF agora. Tente novamente em alguns instantes.',
      details: error.message,
    }, { status: 504 });
  }
}
