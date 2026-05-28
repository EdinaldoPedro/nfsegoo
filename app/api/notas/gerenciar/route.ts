import { NextResponse } from 'next/server';
import { createLog } from '@/app/services/logger';
import { EmissorFactory } from '@/app/services/emissor/factories/EmissorFactory';
import { processarCancelamentoNota } from '@/app/services/notaProcessor';
import { checkPlanLimits } from '@/app/services/planService';
import { validateRequest } from '@/app/utils/api-security';
import { hasEmpresaAccess } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';

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

      const strategy = EmissorFactory.getStrategy(venda.empresa);
      let protocoloParaCancelar = notaAtiva.protocolo;

      const consulta = await strategy.consultar(notaAtiva.chaveAcesso, venda.empresa);

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
      const resultado = await strategy.cancelar(
        notaAtiva.chaveAcesso,
        protocoloParaCancelar,
        justificativa,
        venda.empresa,
      );

      if (!resultado.sucesso) {
        return NextResponse.json({ error: `Erro Sefaz: ${resultado.motivo}` }, { status: 400 });
      }

      const notaAtivaComXml = notaAtiva as any;
      await prisma.notaFiscal.update({
        where: { id: notaAtiva.id },
        data: {
          status: 'CANCELADA',
          xmlAutorizadoBase64: notaAtivaComXml.xmlAutorizadoBase64 || notaAtiva.xmlBase64,
          xmlCancelamentoEventoBase64: resultado.xmlEvento || undefined,
        } as any,
      });
      await prisma.venda.update({ where: { id: vendaId }, data: { status: 'CANCELADA' } });
      await processarCancelamentoNota(notaAtiva.id, venda.empresaId, venda.id);

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
