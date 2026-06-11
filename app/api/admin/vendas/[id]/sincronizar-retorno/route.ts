import { NextResponse } from 'next/server';
import zlib from 'zlib';
import { EmissorFactory } from '@/app/services/emissor/factories/EmissorFactory';
import { createLog } from '@/app/services/logger';
import { NfsePortalDownloader } from '@/app/services/pdf/NfsePortalDownloader';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

async function ensureSupport(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  return null;
}

function escolherNotaSincronizavel(notas: any[]) {
  return (
    notas.find((nota) => ['AUTORIZADA', 'CANCELADA'].includes(nota.status) && nota.chaveAcesso) ||
    notas.find((nota) => nota.chaveAcesso) ||
    null
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function erroTransitavel(motivo?: string | null) {
  const texto = (motivo || '').toLowerCase();
  return [
    'econnreset',
    'timeout',
    'timed out',
    'socket',
    'network',
    '502',
    '503',
    '504',
    'gateway',
  ].some((sinal) => texto.includes(sinal));
}

function temEventoCancelamentoLocal(nota: any) {
  return Boolean(nota?.xmlCancelamentoEventoBase64) || nota?.status === 'CANCELADA';
}

async function consultarComRetry(strategy: any, chaveAcesso: string, empresa: any, attempts = 5) {
  let ultimaResposta: any = null;

  for (let tentativa = 1; tentativa <= attempts; tentativa += 1) {
    try {
      const resposta = await strategy.consultar(chaveAcesso, empresa);
      ultimaResposta = resposta;

      if (resposta.sucesso || !erroTransitavel(resposta.motivo)) {
        return { resposta, tentativas: tentativa };
      }
    } catch (error: any) {
      ultimaResposta = {
        sucesso: false,
        situacao: 'ERRO',
        motivo: error.message || 'Erro na consulta fiscal.',
      };

      if (!erroTransitavel(ultimaResposta.motivo)) {
        return { resposta: ultimaResposta, tentativas: tentativa };
      }
    }

    if (tentativa < attempts) {
      await sleep(1500 * tentativa);
    }
  }

  return { resposta: ultimaResposta, tentativas: attempts };
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

    const nota = escolherNotaSincronizavel(venda.notas);
    if (!nota) {
      return NextResponse.json({ error: 'Venda sem nota fiscal com chave de acesso para sincronizar.' }, { status: 400 });
    }

    if (!venda.empresa.certificadoA1 || !venda.empresa.senhaCertificado) {
      return NextResponse.json({ error: 'Empresa sem certificado digital configurado.' }, { status: 400 });
    }

    await createLog({
      level: 'INFO',
      action: 'SYNC_RETORNO_MANUAL_INICIADO',
      message: 'Sincronizacao manual do retorno fiscal iniciada pela bancada admin.',
      details: {
        notaId: nota.id,
        numeroAtual: nota.numero,
        chaveAcesso: nota.chaveAcesso,
      },
      empresaId: venda.empresaId,
      vendaId: venda.id,
    });

    const strategy = EmissorFactory.getStrategy(venda.empresa);
    const { resposta: consultaRes, tentativas } = await consultarComRetry(strategy, nota.chaveAcesso, venda.empresa, 5);

    if (!consultaRes.sucesso) {
      await createLog({
        level: 'ERRO',
        action: 'SYNC_RETORNO_MANUAL_FALHA',
        message: consultaRes.motivo
          ? `Portal nao retornou dados fiscais apos ${tentativas} tentativa(s): ${consultaRes.motivo}`
          : `Portal nao retornou dados fiscais apos ${tentativas} tentativa(s).`,
        details: {
          notaId: nota.id,
          chaveAcesso: nota.chaveAcesso,
          situacao: consultaRes.situacao,
          motivo: consultaRes.motivo,
          tentativas,
        },
        empresaId: venda.empresaId,
        vendaId: venda.id,
      });

      return NextResponse.json(
        { error: consultaRes.motivo || 'Portal nao retornou dados fiscais para sincronizacao.' },
        { status: 502 },
      );
    }

    const dadosNota: any = {};
    const numeroRecuperado = consultaRes.numeroNota ? parseInt(consultaRes.numeroNota, 10) : 0;
    let pdfAtualizado = false;
    let pdfErro: string | null = null;

    if (numeroRecuperado > 0) dadosNota.numero = numeroRecuperado;
    if (consultaRes.protocolo) dadosNota.protocolo = consultaRes.protocolo;
    const situacaoEfetiva = temEventoCancelamentoLocal(nota) ? 'CANCELADA' : consultaRes.situacao;

    if (situacaoEfetiva === 'CANCELADA') {
      const xmlAutorizadoOriginal = nota.xmlAutorizadoBase64 || nota.xmlBase64;
      dadosNota.status = 'CANCELADA';

      if (xmlAutorizadoOriginal) {
        dadosNota.xmlAutorizadoBase64 = xmlAutorizadoOriginal;
      }

      if (consultaRes.situacao === 'CANCELADA' && consultaRes.xmlDistribuicao) {
        dadosNota.xmlBase64 = consultaRes.xmlDistribuicao;
        dadosNota.xmlCancelamentoEventoBase64 = consultaRes.xmlDistribuicao;
      }

      if (consultaRes.situacao === 'CANCELADA' || !nota.pdfBase64) {
        dadosNota.pdfBase64 = null;
        try {
          const downloader = new NfsePortalDownloader();
          const pdfBuffer = await downloader.downloadPdfOficialComRetry(
            nota.chaveAcesso,
            venda.empresa.certificadoA1,
            venda.empresa.senhaCertificado,
            venda.empresa.id,
            {
              attempts: 5,
              retryDelayMs: 1500,
              requestTimeoutMs: 40000,
            },
          );

          dadosNota.pdfBase64 = zlib.gzipSync(pdfBuffer).toString('base64');
          pdfAtualizado = true;
        } catch (error: any) {
          pdfErro = error.message || 'Nao foi possivel atualizar o PDF cancelado.';
          await createLog({
            level: 'ALERTA',
            action: 'SYNC_CANCELAMENTO_EXTERNO_PDF_FALHA',
            message: 'Cancelamento externo detectado, mas o PDF cancelado nao foi baixado agora.',
            details: {
              notaId: nota.id,
              chaveAcesso: nota.chaveAcesso,
              erro: pdfErro,
            },
            empresaId: venda.empresaId,
            vendaId: venda.id,
          });
        }
      }
    } else if (consultaRes.xmlDistribuicao) {
      dadosNota.xmlBase64 = consultaRes.xmlDistribuicao;
      dadosNota.xmlAutorizadoBase64 = consultaRes.xmlDistribuicao;
    }
    if (situacaoEfetiva === 'AUTORIZADA') dadosNota.status = 'AUTORIZADA';

    if (Object.keys(dadosNota).length > 0) {
      await prisma.notaFiscal.update({
        where: { id: nota.id },
        data: dadosNota,
      });
    }

    const statusVenda =
      situacaoEfetiva === 'CANCELADA'
        ? 'CANCELADA'
        : situacaoEfetiva === 'AUTORIZADA'
          ? 'CONCLUIDA'
          : venda.status;

    await prisma.venda.update({
      where: { id: venda.id },
      data: { status: statusVenda },
    });

    await createLog({
      level: 'INFO',
      action: 'SYNC_RETORNO_MANUAL_CONCLUIDO',
      message: 'Retorno fiscal sincronizado com sucesso pela bancada admin.',
      details: {
        notaId: nota.id,
        numeroAnterior: nota.numero,
        numeroRecuperado: dadosNota.numero || nota.numero,
        situacao: situacaoEfetiva,
        situacaoPortal: consultaRes.situacao,
        cancelamentoLocalPreservado: situacaoEfetiva === 'CANCELADA' && consultaRes.situacao === 'AUTORIZADA',
        xmlAtualizado: Boolean(consultaRes.xmlDistribuicao),
        eventoCancelamentoAtualizado: situacaoEfetiva === 'CANCELADA' && Boolean(consultaRes.xmlDistribuicao),
        pdfAtualizado,
        pdfErro,
        tentativas,
      },
      empresaId: venda.empresaId,
      vendaId: venda.id,
    });

    return NextResponse.json({
      success: true,
      message: 'Retorno fiscal sincronizado com sucesso.',
      notaId: nota.id,
      numero: dadosNota.numero || nota.numero,
      situacao: situacaoEfetiva,
      situacaoPortal: consultaRes.situacao,
      xmlAtualizado: Boolean(consultaRes.xmlDistribuicao),
      eventoCancelamentoAtualizado: situacaoEfetiva === 'CANCELADA' && Boolean(consultaRes.xmlDistribuicao),
      pdfAtualizado,
      pdfErro,
      tentativas,
    });
  } catch (error: any) {
    await createLog({
      level: 'ERRO',
      action: 'SYNC_RETORNO_MANUAL_ERRO',
      message: error.message || 'Erro ao sincronizar retorno fiscal.',
      details: { erro: error.message, vendaId: params.id },
      vendaId: params.id,
    });

    return NextResponse.json(
      { error: error.message || 'Erro ao sincronizar retorno fiscal.' },
      { status: 500 },
    );
  }
}
