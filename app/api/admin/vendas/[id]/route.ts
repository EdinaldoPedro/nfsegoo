import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { createLog, sanitizeLogValue } from '@/app/services/logger';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';
import { getTributacaoPorCnae } from '@/app/utils/tributacao';

async function ensureSupport(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  return null;
}

function sanitizeStoredDetails(details: string | null) {
  if (!details) return details;
  try {
    return JSON.stringify(sanitizeLogValue(JSON.parse(details)), null, 2);
  } catch {
    return sanitizeLogValue(details);
  }
}

function parseJsonObject(value: unknown): any {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string') return parseJsonObject(parsed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function firstDefined(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function onlyDigits(value?: string | null) {
  return String(value || '').replace(/\D/g, '');
}

function mergeFirst(target: Record<string, any>, source: Record<string, any>) {
  for (const [key, value] of Object.entries(source)) {
    if (target[key] === undefined || target[key] === null || target[key] === '') {
      target[key] = value;
    }
  }
}

function extractCorrectionFields(payload: any) {
  if (!payload || typeof payload !== 'object') return {};
  const original = payload.payloadOriginal || payload;
  const servico = original.servico || {};
  const prestador = original.prestador || {};
  const tomador = original.tomador || {};
  const tomadorEndereco = tomador.endereco || {};

  return {
    descricao: firstDefined(original.descricao, servico.descricao),
    valor: firstDefined(original.valor, servico.valor),
    cnae: firstDefined(original.codigoCnae, original.cnae, servico.cnae),
    codigoCnae: firstDefined(original.codigoCnae, original.cnae, servico.cnae),
    numeroDPS: firstDefined(original.numeroDPS, original.meta?.numeroDPS, original.meta?.numero),
    serieDPS: firstDefined(original.serieDPS, original.meta?.serieDPS, original.meta?.serie),
    dataCompetencia: firstDefined(original.dataCompetencia, original.meta?.dataCompetencia),
    aliquota: firstDefined(original.aliquota, servico.aliquota, servico.aliquotaAplicada),
    aliquotaMunicipio: firstDefined(original.aliquotaMunicipio, servico.aliquotaMunicipio),
    issRetido: firstDefined(original.issRetido, servico.issRetido),
    valorMoedaEstrangeira: firstDefined(original.valorMoedaEstrangeira, servico.valorMoedaEstrangeira),
    codigoTributacaoNacional: firstDefined(original.codigoTributacaoNacional, original.codigoTribNacional, servico.codigoTributacaoNacional, servico.codigoTribNacional),
    codigoTribNacional: firstDefined(original.codigoTribNacional, original.codigoTributacaoNacional, servico.codigoTribNacional, servico.codigoTributacaoNacional),
    codigoTributacaoMunicipal: firstDefined(original.codigoTributacaoMunicipal, servico.codigoTributacaoMunicipal),
    codigoNbs: firstDefined(original.codigoNbs, servico.codigoNbs),
    itemLc: firstDefined(original.itemLc, servico.itemLc, servico.itemListaServico),
    tipoTributacao: firstDefined(original.tipoTributacao, servico.tipoTributacao, prestador.configuracoes?.tipoTributacao),
    inscricaoMunicipalPrestador: firstDefined(original.inscricaoMunicipalPrestador, prestador.inscricaoMunicipal),
    regimeEspecialTributacao: firstDefined(original.regimeEspecialTributacao, prestador.configuracoes?.regimeEspecial),
    localPrestacaoIbge: firstDefined(original.localPrestacaoIbge, prestador.endereco?.codigoIbge),
    tomadorDocumento: firstDefined(original.tomadorDocumento, tomador.documento),
    tomadorNome: firstDefined(original.tomadorNome, tomador.razaoSocial, tomador.nome),
    tomadorInscricaoMunicipal: firstDefined(original.tomadorInscricaoMunicipal, tomador.inscricaoMunicipal),
    tomadorEmail: firstDefined(original.tomadorEmail, tomador.email),
    tomadorTelefone: firstDefined(original.tomadorTelefone, tomador.telefone),
    tomadorTipo: firstDefined(original.tomadorTipo, tomador.tipo),
    tomadorNif: firstDefined(original.tomadorNif, tomador.nif),
    tomadorPais: firstDefined(original.tomadorPais, tomador.pais),
    tomadorMoeda: firstDefined(original.tomadorMoeda, tomador.moeda),
    tomadorSemEndereco: firstDefined(original.tomadorSemEndereco, tomador.semEndereco),
    tomadorCep: firstDefined(original.tomadorCep, tomadorEndereco.cep),
    tomadorLogradouro: firstDefined(original.tomadorLogradouro, tomadorEndereco.logradouro),
    tomadorNumero: firstDefined(original.tomadorNumero, tomadorEndereco.numero),
    tomadorComplemento: firstDefined(original.tomadorComplemento, tomadorEndereco.complemento),
    tomadorBairro: firstDefined(original.tomadorBairro, tomadorEndereco.bairro),
    tomadorCidade: firstDefined(original.tomadorCidade, tomadorEndereco.cidade),
    tomadorUf: firstDefined(original.tomadorUf, tomadorEndereco.uf),
    tomadorCodigoIbge: firstDefined(original.tomadorCodigoIbge, tomadorEndereco.codigoIbge),
  };
}

async function montarPayloadRecuperado(venda: any, logsSeguros: any[]) {
  const payloadRecuperado: Record<string, any> = {
    descricao: venda.descricao || '',
    valor: venda.valor !== undefined && venda.valor !== null ? Number(venda.valor) : '',
    serieDPS: venda.empresa?.serieDPS || '900',
    inscricaoMunicipalPrestador: venda.empresa?.inscricaoMunicipal || '',
    regimeEspecialTributacao: venda.empresa?.regimeEspecialTributacao || '',
    localPrestacaoIbge: venda.empresa?.codigoIbge || '',
    tipoTributacao: venda.empresa?.tipoTributacaoPadrao || '1',
    tomadorDocumento: venda.cliente?.documento || '',
    tomadorNome: venda.cliente?.nome || '',
    tomadorInscricaoMunicipal: venda.cliente?.inscricaoMunicipal || '',
    tomadorEmail: venda.cliente?.email || '',
    tomadorTelefone: venda.cliente?.telefone || '',
    tomadorTipo: venda.cliente?.tipo || '',
    tomadorNif: venda.cliente?.nif || '',
    tomadorPais: venda.cliente?.pais || '',
    tomadorMoeda: venda.cliente?.moeda || '',
    tomadorSemEndereco: venda.cliente?.semEndereco === true,
    tomadorCep: venda.cliente?.cep || '',
    tomadorLogradouro: venda.cliente?.logradouro || '',
    tomadorNumero: venda.cliente?.numero || '',
    tomadorComplemento: venda.cliente?.complemento || '',
    tomadorBairro: venda.cliente?.bairro || '',
    tomadorCidade: venda.cliente?.cidade || '',
    tomadorUf: venda.cliente?.uf || '',
    tomadorCodigoIbge: venda.cliente?.codigoIbge || '',
  };

  const jobs = (prisma as any).emissaoJob
    ? await (prisma as any).emissaoJob.findMany({
        where: { vendaId: venda.id },
        orderBy: { createdAt: 'asc' },
        select: { payloadJson: true },
      })
    : [];

  for (const job of jobs) {
    mergeFirst(payloadRecuperado, extractCorrectionFields(parseJsonObject(job.payloadJson)));
  }

  for (const log of logsSeguros) {
    mergeFirst(payloadRecuperado, extractCorrectionFields(parseJsonObject(log.details)));
  }

  const cnae = onlyDigits(payloadRecuperado.codigoCnae || payloadRecuperado.cnae || venda.notas?.[0]?.cnae || '');
  if (cnae) {
    payloadRecuperado.cnae = cnae;
    payloadRecuperado.codigoCnae = cnae;

    const infoEstatica = getTributacaoPorCnae(cnae);
    const regraGlobal = await prisma.globalCnae.findUnique({ where: { codigo: cnae } });
    const regraMunicipal = await prisma.tributacaoMunicipal.findFirst({
      where: { cnae, codigoIbge: venda.empresa?.codigoIbge || '' },
    });

    payloadRecuperado.itemLc = firstDefined(payloadRecuperado.itemLc, regraGlobal?.itemLc, infoEstatica.itemLC);
    payloadRecuperado.codigoTributacaoNacional = firstDefined(
      payloadRecuperado.codigoTributacaoNacional,
      regraGlobal?.codigoTributacaoNacional,
      infoEstatica.codigoTributacaoNacional,
    );
    payloadRecuperado.codigoTribNacional = firstDefined(payloadRecuperado.codigoTribNacional, payloadRecuperado.codigoTributacaoNacional);
    payloadRecuperado.codigoTributacaoMunicipal = firstDefined(payloadRecuperado.codigoTributacaoMunicipal, regraMunicipal?.codigoTributacaoMunicipal);
    payloadRecuperado.codigoNbs = firstDefined(payloadRecuperado.codigoNbs, (regraGlobal as any)?.codigoNbs);
    payloadRecuperado.aliquotaMunicipio = firstDefined(payloadRecuperado.aliquotaMunicipio, regraMunicipal?.aliquotaIss);
  }

  return payloadRecuperado;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  try {
    const venda = await prisma.venda.findUnique({
      where: { id: params.id },
      include: {
        empresa: true,
        cliente: true,
        notas: {
          orderBy: { createdAt: 'desc' },
        },
        logs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!venda) return NextResponse.json({ error: 'Venda nÃ£o encontrada' }, { status: 404 });

    const logsSeguros = venda.logs.map((log) => ({
      ...log,
      details: sanitizeStoredDetails(log.details),
    }));
    const logDps = logsSeguros.find((l) => l.action === 'EMISSAO_INICIADA' || l.action === 'DPS_GERADA');
    const logErro = logsSeguros.find((l) => l.level === 'ERRO' && l.details?.includes('<'));
    const payloadRecuperado = await montarPayloadRecuperado(venda, logsSeguros);

    return NextResponse.json({
      ...venda,
      empresa: stripEmpresaSecrets(venda.empresa),
      logs: logsSeguros,
      payloadJson: logDps ? logDps.details : null,
      payloadRecuperado,
      xmlErro: logErro ? logErro.details : null,
    });
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const authError = await ensureSupport(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const updated = await prisma.venda.update({
      where: { id: params.id },
      data: {
        valor: body.valor ? parseFloat(body.valor) : undefined,
        descricao: body.descricao,
      },
    });
    await createLog({
      level: 'INFO',
      action: 'CORRECAO_RASCUNHO_SALVA',
      message: 'Rascunho tecnico de correcao salvo na bancada admin.',
      empresaId: updated.empresaId,
      vendaId: updated.id,
      details: body,
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Erro ao atualizar venda.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const authError = await ensureSupport(request);
  if (authError) return authError;
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  try {
    const { id } = params;
    const temNotaAutorizada = await prisma.notaFiscal.findFirst({
      where: { vendaId: id, status: 'AUTORIZADA' },
    });

    if (temNotaAutorizada) {
      return NextResponse.json(
        { error: 'NÃ£o Ã© possÃ­vel excluir uma venda com Nota Autorizada. Cancele a nota primeiro.' },
        { status: 403 },
      );
    }

    await prisma.notaFiscal.updateMany({
      where: { vendaId: id },
      data: {
        arquivadoEm: new Date(),
        arquivadoPor: user.id,
        motivoArquivamento: 'Exclusao solicitada no painel admin.',
      } as any,
    });
    await prisma.venda.update({
      where: { id },
      data: {
        status: 'ARQUIVADA',
        arquivadoEm: new Date(),
        arquivadoPor: user.id,
        motivoArquivamento: 'Exclusao solicitada no painel admin.',
      } as any,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Erro ao excluir venda.' }, { status: 500 });
  }
}
