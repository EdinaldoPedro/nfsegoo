import { NextResponse } from 'next/server';
import { createLog } from '@/app/services/logger';
import { validateRequest } from '@/app/utils/api-security';
import { hasEmpresaAccess } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { getInternalBaseUrl } from '@/app/utils/request-url';

function parsePayload(payloadJson?: string | null) {
  if (!payloadJson) return {};
  try {
    const parsed = JSON.parse(payloadJson);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function firstDefined(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

export async function POST(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  const userId = targetId;
  if (!userId || !user) return NextResponse.json({ error: 'Auth required' }, { status: 401 });
  let retryVendaId: string | null = null;
  let retryEmpresaId: string | null = null;

  try {
    const { vendaId, dadosAtualizados } = await request.json();
    retryVendaId = vendaId;

    const venda = await prisma.venda.findUnique({
      where: { id: vendaId },
      include: { empresa: true, cliente: true },
    });

    if (!venda) throw new Error('Venda nÃ£o encontrada para reprocessamento.');

    const hasAccess = await hasEmpresaAccess(user, venda.empresaId);
    retryEmpresaId = venda.empresaId;
    if (!hasAccess) {
      return NextResponse.json({ error: 'Acesso proibido' }, { status: 403 });
    }

    const jobOrigem = (prisma as any).emissaoJob
      ? await (prisma as any).emissaoJob.findFirst({
        where: { vendaId: venda.id },
        orderBy: { createdAt: 'asc' },
        select: { payloadJson: true },
      })
      : null;
    const payloadOrigem = parsePayload(jobOrigem?.payloadJson);

    await createLog({
      level: 'INFO',
      action: 'REENVIO_MANUAL',
      message: 'SolicitaÃ§Ã£o de reenvio iniciada pelo painel administrativo.',
      empresaId: venda.empresaId,
      vendaId: venda.id,
    });

    await prisma.venda.update({
      where: { id: vendaId },
      data: {
        descricao: dadosAtualizados.descricao || venda.descricao,
        valor: dadosAtualizados.valor ? parseFloat(String(dadosAtualizados.valor)) : venda.valor,
        status: 'PROCESSANDO',
      },
    });

    const baseUrl = getInternalBaseUrl(request);

    const resEmissao = await fetch(`${baseUrl}/api/notas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: request.headers.get('cookie') || '',
        'x-user-id': userId,
        'x-empresa-id': venda.empresaId,
      },
      body: JSON.stringify({
        vendaId: venda.id,
        clienteId: venda.clienteId,
        valor: firstDefined(dadosAtualizados.valor, payloadOrigem.valor, venda.valor),
        descricao: firstDefined(dadosAtualizados.descricao, payloadOrigem.descricao, venda.descricao),
        codigoCnae: firstDefined(dadosAtualizados.codigoCnae, dadosAtualizados.cnae, payloadOrigem.codigoCnae),
        valorMoedaEstrangeira: firstDefined(dadosAtualizados.valorMoedaEstrangeira, payloadOrigem.valorMoedaEstrangeira),
        aliquota: firstDefined(dadosAtualizados.aliquota, payloadOrigem.aliquota),
        aliquotaMunicipio: firstDefined(dadosAtualizados.aliquotaMunicipio, payloadOrigem.aliquotaMunicipio),
        issRetido: firstDefined(dadosAtualizados.issRetido, payloadOrigem.issRetido),
        dataCompetencia: firstDefined(dadosAtualizados.dataCompetencia, payloadOrigem.dataCompetencia),
        retencoes: firstDefined(dadosAtualizados.retencoes, payloadOrigem.retencoes),
        numeroDPS: firstDefined(dadosAtualizados.numeroDPS, payloadOrigem.numeroDPS),
        serieDPS: firstDefined(dadosAtualizados.serieDPS, payloadOrigem.serieDPS),
        codigoTributacaoNacional: firstDefined(dadosAtualizados.codigoTributacaoNacional, dadosAtualizados.codigoTribNacional, payloadOrigem.codigoTributacaoNacional, payloadOrigem.codigoTribNacional),
        codigoTribNacional: firstDefined(dadosAtualizados.codigoTribNacional, dadosAtualizados.codigoTributacaoNacional, payloadOrigem.codigoTribNacional, payloadOrigem.codigoTributacaoNacional),
        codigoTributacaoMunicipal: firstDefined(dadosAtualizados.codigoTributacaoMunicipal, payloadOrigem.codigoTributacaoMunicipal),
        codigoNbs: firstDefined(dadosAtualizados.codigoNbs, payloadOrigem.codigoNbs),
        itemLc: firstDefined(dadosAtualizados.itemLc, payloadOrigem.itemLc),
        tipoTributacao: firstDefined(dadosAtualizados.tipoTributacao, payloadOrigem.tipoTributacao),
        inscricaoMunicipalPrestador: firstDefined(dadosAtualizados.inscricaoMunicipalPrestador, payloadOrigem.inscricaoMunicipalPrestador),
        regimeEspecialTributacao: firstDefined(dadosAtualizados.regimeEspecialTributacao, payloadOrigem.regimeEspecialTributacao),
        localPrestacaoIbge: firstDefined(dadosAtualizados.localPrestacaoIbge, payloadOrigem.localPrestacaoIbge),
        tomadorDocumento: firstDefined(dadosAtualizados.tomadorDocumento, payloadOrigem.tomadorDocumento),
        tomadorNome: firstDefined(dadosAtualizados.tomadorNome, payloadOrigem.tomadorNome),
        tomadorInscricaoMunicipal: firstDefined(dadosAtualizados.tomadorInscricaoMunicipal, payloadOrigem.tomadorInscricaoMunicipal),
        tomadorEmail: firstDefined(dadosAtualizados.tomadorEmail, payloadOrigem.tomadorEmail),
        tomadorTelefone: firstDefined(dadosAtualizados.tomadorTelefone, payloadOrigem.tomadorTelefone),
        tomadorTipo: firstDefined(dadosAtualizados.tomadorTipo, payloadOrigem.tomadorTipo),
        tomadorNif: firstDefined(dadosAtualizados.tomadorNif, payloadOrigem.tomadorNif),
        tomadorPais: firstDefined(dadosAtualizados.tomadorPais, payloadOrigem.tomadorPais),
        tomadorMoeda: firstDefined(dadosAtualizados.tomadorMoeda, payloadOrigem.tomadorMoeda),
        tomadorSemEndereco: firstDefined(dadosAtualizados.tomadorSemEndereco, payloadOrigem.tomadorSemEndereco),
        tomadorCep: firstDefined(dadosAtualizados.tomadorCep, payloadOrigem.tomadorCep),
        tomadorLogradouro: firstDefined(dadosAtualizados.tomadorLogradouro, payloadOrigem.tomadorLogradouro),
        tomadorNumero: firstDefined(dadosAtualizados.tomadorNumero, payloadOrigem.tomadorNumero),
        tomadorComplemento: firstDefined(dadosAtualizados.tomadorComplemento, payloadOrigem.tomadorComplemento),
        tomadorBairro: firstDefined(dadosAtualizados.tomadorBairro, payloadOrigem.tomadorBairro),
        tomadorCidade: firstDefined(dadosAtualizados.tomadorCidade, payloadOrigem.tomadorCidade),
        tomadorUf: firstDefined(dadosAtualizados.tomadorUf, payloadOrigem.tomadorUf),
        tomadorCodigoIbge: firstDefined(dadosAtualizados.tomadorCodigoIbge, payloadOrigem.tomadorCodigoIbge),
      }),
    });

    const resultado = await resEmissao.json().catch(() => ({
      error: `Resposta invalida da API de emissao. HTTP ${resEmissao.status}`,
    }));

    if (!resEmissao.ok) {
      await prisma.venda.update({ where: { id: vendaId }, data: { status: 'ERRO_EMISSAO' } });
      await createLog({
        level: 'ERRO',
        action: 'FALHA_REENVIO_MANUAL',
        message: resultado.error || 'Falha no reenvio manual.',
        empresaId: venda.empresaId,
        vendaId: venda.id,
        details: resultado,
      });
      return NextResponse.json(resultado, { status: resEmissao.status });
    }

    return NextResponse.json({ success: true, message: 'Reenvio processado com sucesso!' });
  } catch (error: any) {
    console.error('[RETRY ERROR]', error);
    try {
      if (retryVendaId) {
        const venda = await prisma.venda.update({
          where: { id: retryVendaId },
          data: { status: 'ERRO_EMISSAO' },
        });
        await createLog({
          level: 'ERRO',
          action: 'FALHA_REENVIO_MANUAL',
          message: error.message || 'Erro interno no reenvio manual.',
          empresaId: retryEmpresaId || venda.empresaId,
          vendaId: venda.id,
          details: { stack: error.stack },
        });
      }
    } catch {}
    return NextResponse.json({ error: error.message || 'Erro interno no reenvio.' }, { status: 500 });
  }
}
