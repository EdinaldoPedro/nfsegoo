import { NextResponse } from 'next/server';
import { createLog } from '@/app/services/logger';
import { EmissorFactory } from '@/app/services/emissor/factories/EmissorFactory';
import { processarCancelamentoNota } from '@/app/services/notaProcessor';
import { checkPlanLimits } from '@/app/services/planService';
import { validateRequest } from '@/app/utils/api-security';
import { hasEmpresaAccess } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function erroTransitavel(motivo?: string | null) {
  const texto = (motivo || '').toLowerCase();
  return [
    '503',
    '502',
    '504',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
    'econnreset',
    'timeout',
    'timed out',
    'socket',
    'network',
  ].some((sinal) => texto.includes(sinal));
}

async function executarComRetry<T extends { sucesso: boolean; motivo?: string }>(
  fn: () => Promise<T>,
  attempts = 5,
) {
  let ultimaResposta: T | null = null;

  for (let tentativa = 1; tentativa <= attempts; tentativa += 1) {
    try {
      const resposta = await fn();
      ultimaResposta = resposta;
      if (resposta.sucesso || !erroTransitavel(resposta.motivo)) {
        return { resposta, tentativas: tentativa };
      }
    } catch (error: any) {
      ultimaResposta = { sucesso: false, motivo: error.message || 'Erro temporario no Portal.' } as T;
      if (!erroTransitavel(ultimaResposta.motivo)) {
        return { resposta: ultimaResposta, tentativas: tentativa };
      }
    }

    if (tentativa < attempts) {
      await sleep(2000 + tentativa * 1500);
    }
  }

  return { resposta: ultimaResposta as T, tentativas: attempts };
}

export async function POST(request: Request) {
  try {
    const { user, targetId, errorResponse } = await validateRequest(request);
    if (errorResponse) return errorResponse;
    const userId = targetId;
    if (!userId || !user) return NextResponse.json({ error: 'Auth required' }, { status: 401 });

    const { acao, vendaId, motivo } = await request.json();

    if (acao === 'CANCELAR') {
      const planCheck = await checkPlanLimits(userId, 'EMITIR');
      if (!planCheck.allowed) {
        return NextResponse.json(
          {
            error: `AÃ§Ã£o bloqueada: ${planCheck.reason}`,
            code: planCheck.status,
          },
          { status: 403 },
        );
      }
    }

    const venda = await prisma.venda.findUnique({
      where: { id: vendaId },
      include: { notas: true, empresa: true },
    });

    if (!venda) return NextResponse.json({ error: 'Venda nÃ£o encontrada' }, { status: 404 });

    const hasAccess = await hasEmpresaAccess(user, venda.empresaId);
    if (!hasAccess) return NextResponse.json({ error: 'Acesso proibido' }, { status: 403 });

    if (acao === 'CANCELAR') {
      const notaAtiva = venda.notas.find((n) => n.status === 'AUTORIZADA' || n.status === 'CANCELADA');

      if (!notaAtiva || !notaAtiva.chaveAcesso) {
        return NextResponse.json({ error: 'NÃ£o hÃ¡ nota autorizada vÃ¡lida para processar.' }, { status: 400 });
      }

      const chaveAcesso = notaAtiva.chaveAcesso;
      const strategy = EmissorFactory.getStrategy(venda.empresa);
      let protocoloParaCancelar = notaAtiva.protocolo;

      const { resposta: consulta, tentativas: tentativasConsulta } = await executarComRetry(
        () => strategy.consultar(chaveAcesso, venda.empresa),
        5,
      );

      if (consulta.sucesso && consulta.protocolo && !protocoloParaCancelar) {
        protocoloParaCancelar = consulta.protocolo;
        await prisma.notaFiscal.update({
          where: { id: notaAtiva.id },
          data: { protocolo: protocoloParaCancelar },
        });
      }

      if (consulta.sucesso && consulta.situacao === 'CANCELADA') {
        const notaAtivaComXml = notaAtiva as any;
        await prisma.notaFiscal.update({
          where: { id: notaAtiva.id },
          data: {
            status: 'CANCELADA',
            xmlAutorizadoBase64: notaAtivaComXml.xmlAutorizadoBase64 || notaAtiva.xmlBase64,
            pdfBase64: null,
          } as any,
        });
        await prisma.venda.update({ where: { id: vendaId }, data: { status: 'CANCELADA' } });
        await processarCancelamentoNota(notaAtiva.id, venda.empresaId, venda.id);
        return NextResponse.json({ success: true, message: 'Nota sincronizada! Status atualizado para Cancelada.' });
      }

      if (!protocoloParaCancelar) {
        return NextResponse.json(
          { error: 'Erro: Protocolo nÃ£o encontrado e status nÃ£o Ã© cancelado.' },
          { status: 400 },
        );
      }

      const justificativa = motivo || 'Erro na emissÃ£o';
      const { resposta: resultado, tentativas: tentativasCancelamento } = await executarComRetry(
        () => strategy.cancelar(
          chaveAcesso,
          protocoloParaCancelar,
          justificativa,
          venda.empresa,
        ),
        5,
      );

      if (!resultado.sucesso) {
        return NextResponse.json({
          error: erroTransitavel(resultado.motivo)
            ? `Portal Nacional indisponivel para cancelamento apos ${tentativasCancelamento} tentativa(s). Tente novamente em alguns instantes.`
            : `Erro Sefaz: ${resultado.motivo}`,
        }, { status: 400 });
      }

      const notaAtivaComXml = notaAtiva as any;
      await prisma.notaFiscal.update({
        where: { id: notaAtiva.id },
        data: {
          status: 'CANCELADA',
          xmlAutorizadoBase64: notaAtivaComXml.xmlAutorizadoBase64 || notaAtiva.xmlBase64,
          xmlCancelamentoEventoBase64: resultado.xmlEvento || undefined,
          pdfBase64: null,
        } as any,
      });
      await prisma.venda.update({ where: { id: vendaId }, data: { status: 'CANCELADA' } });
      await processarCancelamentoNota(notaAtiva.id, venda.empresaId, venda.id);

      await createLog({
        level: 'INFO',
        action: 'CANCELAMENTO_AUTORIZADO',
        message: 'Cancelamento autorizado pelo Portal Nacional.',
        empresaId: venda.empresaId,
        vendaId: venda.id,
        details: {
          tentativasConsulta,
          tentativasCancelamento,
          protocolo: protocoloParaCancelar,
        },
      });

      return NextResponse.json({ success: true, message: 'Nota cancelada com sucesso.' });
    }

    if (acao === 'CORRIGIR') {
      await prisma.venda.update({ where: { id: vendaId }, data: { status: 'PENDENTE' } });
      return NextResponse.json({ success: true, message: 'Venda liberada.' });
    }

    return NextResponse.json({ error: 'AÃ§Ã£o invÃ¡lida.' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
