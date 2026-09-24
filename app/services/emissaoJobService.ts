import { prisma } from '@/app/utils/prisma';
import { EmissorFactory } from '@/app/services/emissor/factories/EmissorFactory';
import { getTributacaoPorCnae } from '@/app/utils/tributacao';
import { checkPlanLimits, reserveEmissionCreditInTransaction, resolveBillingUserId } from '@/app/services/planService';
import { commercialTransaction } from '@/app/services/commercialService';
import { hasCustomerCompanyAccess, resolveEmpresaContexto } from '@/app/utils/access-control';
import { findTenantCustomer } from '@/app/services/tenantCustomerService';
import { isPercentualFiscalValido, parseDecimalInput } from '@/app/utils/number-format';
import { assertFiscalDecision, resolveFiscalDecision } from '@/app/services/emissor/fiscal/FiscalRuleEngine';
import { getPfAddressRequiredMessage, PF_ADDRESS_REQUIRED_CODE } from '@/app/utils/customer-address';
import { assertRegimeTributarioSuportado } from '@/app/utils/regime-tributario';
import { normalizeDpsNumber, normalizeDpsSeries } from '@/app/utils/dps-identity';
import { readEmissionConfirmation, assertEmissionConfirmation } from '@/app/utils/emission-confirmation';
import type { Prisma } from '@prisma/client';

type CriarEmissaoJobParams = {
  userId: string;
  contextId: string | null;
  body: any;
  idempotencyKey?: string | null;
  source?: string;
};

type CriarEmissaoJobResult = {
  job: any;
  venda: any;
  existing: boolean;
};

function getIntEnv(name: string, fallback: number) {
  const valor = Number(process.env[name]);
  return Number.isSafeInteger(valor) && valor > 0 && valor <= 100 ? valor : fallback;
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getPartitionKey(empresaId: string) {
  const partitions = getIntEnv('EMISSION_QUEUE_PARTITIONS', 16);
  return hashString(empresaId) % partitions;
}

function parsePayloadSeguro(payloadJson?: string | null) {
  if (!payloadJson) return {};
  try {
    return JSON.parse(payloadJson);
  } catch {
    return {};
  }
}

function firstDefined(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function optionalString(value: any) {
  const resolved = firstDefined(value);
  if (resolved === undefined) return undefined;
  const text = String(resolved).trim();
  return text ? text : undefined;
}

function parseNumero(value: any, fallback = 0) {
  return parseDecimalInput(value, fallback);
}

function parseBoolean(value: any, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'sim', 's', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'nao', 'não', 'n', 'no'].includes(normalized)) return false;
  return fallback;
}

type FiscalResolutionDb = Prisma.TransactionClient;

export async function resolveEmissionFiscalContext(params: {
  payload: any;
  prestador: any;
  tomador: any;
  valorFloat: number;
}, db: FiscalResolutionDb = prisma) {
  const { payload, prestador, tomador, valorFloat } = params;
  const regimePrestador = assertRegimeTributarioSuportado(prestador.regimeTributario);

  let cnaeFinal = payload.codigoCnae ? String(payload.codigoCnae).replace(/\D/g, '') : '';
  if (!cnaeFinal) {
    const cnaeBanco = await db.cnae.findFirst({ where: { empresaId: prestador.id, principal: true } });
    if (cnaeBanco) cnaeFinal = cnaeBanco.codigo.replace(/\D/g, '');
  }
  if (!cnaeFinal) throw Object.assign(new Error('CNAE e obrigatorio para emissao.'), { status: 400 });

  let codigoTribNacional = '000000';
  let itemLc = '00.00';
  let nbsEncontrado = '';
  let codigoNbs = '';

  const infoEstatica = getTributacaoPorCnae(cnaeFinal);
  if (infoEstatica) {
    itemLc = infoEstatica.itemLC;
    codigoTribNacional = infoEstatica.codigoTributacaoNacional.replace(/\D/g, '');
    if ((infoEstatica as any).codigoNbs) nbsEncontrado = (infoEstatica as any).codigoNbs;
  }

  const dataCompetenciaRegra = new Date(`${String(payload.dataCompetencia || new Date().toISOString().slice(0, 10)).slice(0, 10)}T12:00:00.000Z`);
  const regraGlobal = await db.globalCnae.findFirst({
    where: {
      codigo: cnaeFinal,
      AND: [
        { OR: [{ inicioVigencia: null }, { inicioVigencia: { lte: dataCompetenciaRegra } }] },
        { OR: [{ fimVigencia: null }, { fimVigencia: { gte: dataCompetenciaRegra } }] },
      ],
    },
  });
  if (regraGlobal) {
    if (regraGlobal.itemLc) itemLc = regraGlobal.itemLc;
    if (regraGlobal.codigoTributacaoNacional) codigoTribNacional = regraGlobal.codigoTributacaoNacional.replace(/\D/g, '');
    if ((regraGlobal as any).codigoNbs) nbsEncontrado = (regraGlobal as any).codigoNbs;
  }

  const regraMunicipal = await db.tributacaoMunicipal.findFirst({
    where: {
      cnae: cnaeFinal,
      codigoIbge: prestador.codigoIbge || '',
      ativo: true,
      AND: [
        { OR: [{ inicioVigencia: null }, { inicioVigencia: { lte: dataCompetenciaRegra } }] },
        { OR: [{ fimVigencia: null }, { fimVigencia: { gte: dataCompetenciaRegra } }] },
      ],
    },
    orderBy: [{ prioridade: 'desc' }, { updatedAt: 'desc' }],
  });

  if (regraMunicipal?.exigeNbs && nbsEncontrado) codigoNbs = nbsEncontrado;

  codigoTribNacional = optionalString(firstDefined(payload.codigoTributacaoNacional, payload.codigoTribNacional, codigoTribNacional))?.replace(/\D/g, '') || codigoTribNacional;
  itemLc = optionalString(firstDefined(payload.itemLc, itemLc)) || itemLc;
  codigoNbs = optionalString(firstDefined(payload.codigoNbs, codigoNbs)) || '';
  const codigoMunicipalInformado = optionalString(payload.codigoTributacaoMunicipal);
  const cadastroPf = String(tomador.tipo || '').toUpperCase() === 'PF';
  const tomadorTipo = cadastroPf ? 'PF' : optionalString(firstDefined(payload.tomadorTipo, tomador.tipo)) || tomador.tipo;
  const tomadorPais = optionalString(firstDefined(payload.tomadorPais, tomador.pais)) || tomador.pais;
  const fiscalDecision = await resolveFiscalDecision({
    cnae: cnaeFinal,
    itemLc,
    codigoIbge: optionalString(firstDefined(payload.localPrestacaoIbge, prestador.codigoIbge)) || '',
    regimeTributario: regimePrestador,
    ambiente: prestador.ambiente,
    dataCompetencia: payload.dataCompetencia,
    valor: valorFloat,
    codigoNbs,
    codigoTributacaoMunicipal: codigoMunicipalInformado,
    tomadorTipo,
    tomadorPais: tomadorPais || undefined,
    retencoes: payload.retencoes,
    tributosFederaisDevidos: payload.tributosFederaisDevidos,
    ibscbs: payload.ibscbs,
  }, db);
  assertFiscalDecision(fiscalDecision);

  codigoNbs = fiscalDecision.codigoNbs || codigoNbs;
  const codigoTributacaoMunicipal = regimePrestador === 'MEI'
    ? undefined
    : fiscalDecision.codigoTributacaoMunicipal;
  const aliquotaMunicipio = regimePrestador === 'MEI'
    ? undefined
    : firstDefined(payload.aliquotaMunicipio, fiscalDecision.aliquotaIssMunicipal, regraMunicipal?.aliquotaIss);
  const aliquotaIss = payload.aliquota ? parseNumero(payload.aliquota) : 0;
  const aliquotaIssEfetiva = aliquotaIss || parseNumero(prestador.aliquotaPadrao) || 0;
  const aliquotaMunicipioNumero = aliquotaMunicipio ? parseNumero(aliquotaMunicipio) : null;
  if (!isPercentualFiscalValido(aliquotaIssEfetiva, { allowZero: true })) {
    throw Object.assign(new Error('Aliquota ISS invalida. Informe um percentual entre 0 e 100, por exemplo 2,01 ou 2.01.'), {
      status: 400,
      userAction: 'Revise a aliquota ISS antes de reenviar. Use percentual entre 0 e 100, como 2,01 ou 2.01.',
      code: 'ALIQUOTA_ISS_INVALIDA',
    });
  }
  if (aliquotaMunicipioNumero !== null && !isPercentualFiscalValido(aliquotaMunicipioNumero, { allowZero: true })) {
    throw Object.assign(new Error('Aliquota municipal invalida. Informe um percentual entre 0 e 100.'), {
      status: 400,
      userAction: 'Revise a aliquota municipal antes de reenviar. Use percentual entre 0 e 100.',
      code: 'ALIQUOTA_MUNICIPAL_INVALIDA',
    });
  }

  return {
    regimePrestador,
    cnaeFinal,
    codigoTribNacional,
    itemLc,
    codigoNbs,
    codigoTributacaoMunicipal,
    cadastroPf,
    tomadorTipo,
    tomadorPais,
    fiscalDecision,
    aliquotaIss,
    aliquotaMunicipioNumero,
    tipoTributacao: optionalString(firstDefined(payload.tipoTributacao, prestador.tipoTributacaoPadrao)),
  };
}

function normalizarPayload(body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Dados da emissão inválidos.'), { status: 400 });
  const {
    clienteId,
    valor,
    descricao,
    codigoCnae,
    cnae,
    vendaId,
    copiaDeVendaId,
    empresaConfirmadaId,
    ambienteConfirmado,
    aliquota,
    aliquotaMunicipio,
    issRetido,
    retencoes,
    numeroDPS,
    serieDPS,
    valorMoedaEstrangeira,
    dataCompetencia,
    codigoTributacaoNacional,
    codigoTribNacional,
    codigoTributacaoMunicipal,
    codigoNbs,
    itemLc,
    tipoTributacao,
    inscricaoMunicipalPrestador,
    regimeEspecialTributacao,
    localPrestacaoIbge,
    tomadorDocumento,
    tomadorNome,
    tomadorInscricaoMunicipal,
    tomadorEmail,
    tomadorTelefone,
    tomadorTipo,
    tomadorNif,
    tomadorPais,
    tomadorMoeda,
    tomadorCep,
    tomadorLogradouro,
    tomadorNumero,
    tomadorComplemento,
    tomadorBairro,
    tomadorCidade,
    tomadorUf,
    tomadorCodigoIbge,
    idempotencyKey,
  } = body;

  return {
    clienteId,
    valor,
    descricao,
    codigoCnae: codigoCnae || cnae,
    cnae,
    vendaId,
    copiaDeVendaId,
    empresaConfirmadaId,
    ambienteConfirmado,
    aliquota,
    aliquotaMunicipio,
    issRetido,
    retencoes,
    numeroDPS: numeroDPS === undefined || numeroDPS === null || numeroDPS === '' ? undefined : normalizeDpsNumber(numeroDPS),
    serieDPS: serieDPS === undefined || serieDPS === null || serieDPS === '' ? undefined : normalizeDpsSeries(serieDPS),
    valorMoedaEstrangeira,
    dataCompetencia,
    codigoTributacaoNacional,
    codigoTribNacional,
    codigoTributacaoMunicipal,
    codigoNbs,
    itemLc,
    tipoTributacao,
    inscricaoMunicipalPrestador,
    regimeEspecialTributacao,
    localPrestacaoIbge,
    tomadorDocumento,
    tomadorNome,
    tomadorInscricaoMunicipal,
    tomadorEmail,
    tomadorTelefone,
    tomadorTipo,
    tomadorNif,
    tomadorPais,
    tomadorMoeda,
    tomadorSemEndereco: false,
    tomadorCep,
    tomadorLogradouro,
    tomadorNumero,
    tomadorComplemento,
    tomadorBairro,
    tomadorCidade,
    tomadorUf,
    tomadorCodigoIbge,
    idempotencyKey,
  };
}

function frozenCustomerSnapshot(tomador: any) {
  return Object.fromEntries([
    'id', 'empresaId', 'entidadeFiscalId', 'tipo', 'documento', 'nome', 'nomeFantasia', 'email', 'telefone',
    'inscricaoMunicipal', 'inscricaoEstadual', 'cep', 'logradouro', 'numero', 'complemento', 'bairro',
    'cidade', 'uf', 'pais', 'codigoIbge', 'semEndereco', 'moeda', 'nif',
  ].map(key => [key, tomador[key] ?? null]));
}

function assertTomadorPfComEndereco(tomador: any) {
  if (String(tomador?.tipo || '').toUpperCase() !== 'PF') return;
  const message = getPfAddressRequiredMessage(tomador);
  if (!message) return;

  throw Object.assign(new Error(message), {
    status: 400,
    code: PF_ADDRESS_REQUIRED_CODE,
    userAction: message,
  });
}

export async function criarEmissaoJob(params: CriarEmissaoJobParams): Promise<CriarEmissaoJobResult> {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) throw Object.assign(new Error('Usuario nao autenticado.'), { status: 401 });

  const payload = normalizarPayload(params.body);
  const confirmation = readEmissionConfirmation(payload);
  if (payload.copiaDeVendaId !== undefined && payload.copiaDeVendaId !== null &&
      (typeof payload.copiaDeVendaId !== 'string' || !payload.copiaDeVendaId || payload.copiaDeVendaId.length > 100 || payload.vendaId)) {
    throw Object.assign(new Error('Origem da cópia inválida. Uma cópia sempre cria uma nova venda.'), { status: 400 });
  }
  const empresaIdAlvo = await resolveEmpresaContexto(user, params.contextId);
  if (!empresaIdAlvo) throw Object.assign(new Error('Acesso negado a empresa selecionada.'), { status: 403 });

  const idempotencyKey = params.idempotencyKey || payload.idempotencyKey;
  if (typeof idempotencyKey !== 'string' || !/^[a-z0-9:_-]{8,160}$/i.test(idempotencyKey)) {
    throw Object.assign(new Error('Chave de idempotência inválida.'), { status: 400 });
  }

  const prestador = await prisma.empresa.findUnique({ where: { id: empresaIdAlvo } });
  if (!prestador || !prestador.documento) {
    throw Object.assign(new Error('Cadastro incompleto.'), {
      status: 400,
      userAction: 'Voce ainda nao concluiu o cadastro da sua Empresa. Acesse as Configuracoes para preencher seus dados basicos.',
    });
  }

  assertRegimeTributarioSuportado(prestador.regimeTributario);

  if (!prestador.certificadoA1) {
    throw Object.assign(new Error('Certificado nao encontrado.'), {
      status: 400,
      userAction: 'Para emitir notas, voce precisa de um Certificado Digital (e-CNPJ). Acesse as Configuracoes da Empresa e faca o upload do seu certificado A1.',
    });
  }

  const tomador = await findTenantCustomer(payload.clienteId, empresaIdAlvo);
  if (!tomador) throw Object.assign(new Error('Tomador (Cliente) nao encontrado.'), { status: 400 });
  payload.clienteId = tomador.id;
  const valorFloat = parseFloat(payload.valor);
  if (!Number.isFinite(valorFloat) || valorFloat <= 0) {
    throw Object.assign(new Error('Valor da nota invalido.'), { status: 400 });
  }
  // Valida antes da reserva do credito do plano: cadastro incompleto nao consome emissao.
  assertTomadorPfComEndereco(tomador);

  const billingUserId = await resolveBillingUserId({ empresaId: empresaIdAlvo, actorUserId: user.id, acao: 'EMITIR' });

  return commercialTransaction(billingUserId, async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: user.id }, select: { id: true, role: true, empresaId: true } });
    if (!actor || !await hasCustomerCompanyAccess(actor, empresaIdAlvo, tx)) throw Object.assign(new Error('Perfil sem permissão para emitir por esta empresa.'), { status: 403 });
    await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${empresaIdAlvo} FOR UPDATE`;
    const cancelledRequest = await tx.emissionRequestBlock.findUnique({ where: { empresaId_idempotencyKey: { empresaId: empresaIdAlvo, idempotencyKey } } });
    if (cancelledRequest) throw Object.assign(new Error('Solicitação descartada antes do registro. Inicie uma nova solicitação.'), { status: 409 });
    const currentCompany = await tx.empresa.findFirst({ where: { id: empresaIdAlvo, arquivadoEm: null, OR: [
      { id: actor.empresaId || '' }, { proprietarioUserId: actor.id }, { vinculadoA: { some: { userId: actor.id, revokedAt: null } } },
      { contadoresLink: { some: { contadorId: actor.id, status: 'APROVADO', arquivadoEm: null } } },
    ] } });
    if (!currentCompany) throw Object.assign(new Error('Vínculo com a empresa revogado.'), { status: 403 });
    const primaryOwner = await tx.user.findUnique({ where: { empresaId: empresaIdAlvo }, select: { id: true, role: true } });
    const currentBillingOwner = currentCompany.modoCobranca === 'POR_OPERADOR' ? actor.id
      : currentCompany.donoFaturamentoId || currentCompany.proprietarioUserId
        || primaryOwner?.id || currentCompany.contadorCustodianteId;
    if (currentBillingOwner !== billingUserId) throw Object.assign(new Error('Responsável financeiro alterado. Confira a operação novamente.'), { status: 409 });
    const existing = await tx.emissaoJob.findUnique({ where: { empresaId_idempotencyKey: { empresaId: empresaIdAlvo, idempotencyKey } } });
    if (existing) {
      const stored = parsePayloadSeguro(existing.payloadJson);
      const original = stored._requestPayload && typeof stored._requestPayload === 'object'
        ? normalizarPayload(stored._requestPayload) : normalizarPayload(stored);
      if (JSON.stringify(original) !== JSON.stringify(payload)) throw Object.assign(new Error('Chave já usada com outros dados. Atualize a solicitação.'), { status: 409 });
      return { job: existing, venda: existing.vendaId ? await tx.venda.findUnique({ where: { id: existing.vendaId } }) : null, existing: true };
    }
    // A web request must not promise processing when no emission process can
    // claim it. Other worker types are not evidence of emission capacity.
    const heartbeat = await tx.workerHeartbeat.findFirst({ where: {
      id: { startsWith: 'emission-' },
      updatedAt: { gt: new Date(Date.now() - 45_000) },
      ...(currentCompany.ambiente === 'PRODUCAO' ? { productionEnabled: true } : {}),
    }, select: { id: true } });
    if (!heartbeat) throw Object.assign(new Error('Processador de emissões indisponível. Nenhuma nova nota foi registrada. Tente novamente quando o serviço voltar.'), {
      status: 409, code: 'EMISSION_PROCESSOR_UNAVAILABLE',
    });
    // An idempotent replay returns only the original job; a NEW request must
    // match the company/environment actually reviewed, under the company lock.
    assertEmissionConfirmation(confirmation, currentCompany);
    if (currentCompany.ambiente !== prestador.ambiente) throw Object.assign(new Error('Ambiente alterado. Confira a emissão novamente.'), { status: 409 });
    // Administrative archiving and edits use the same company mutex. A customer
    // resolved before waiting for it must not authorize a new, stale submission.
    const currentCustomer = await findTenantCustomer(tomador.id, empresaIdAlvo, tx);
    if (!currentCustomer || currentCustomer.updatedAt.getTime() !== tomador.updatedAt.getTime()) throw Object.assign(new Error('Tomador alterado ou arquivado. Recarregue e confira os dados antes de emitir.'), { status: 409 });
    assertTomadorPfComEndereco(currentCustomer);
    const outstanding = await tx.emissaoJob.findFirst({ where: { empresaId: empresaIdAlvo, actorUserId: actor.id, acknowledgedAt: null }, select: { id: true } });
    if (outstanding) throw Object.assign(new Error('Existe uma solicitação anterior ainda não conferida. Abra a tela de emissão para acompanhar seu resultado.'), { status: 409 });
    if (payload.copiaDeVendaId) {
      const source = await tx.venda.findFirst({ where: { id: payload.copiaDeVendaId, empresaId: empresaIdAlvo, clienteId: tomador.id, arquivadoEm: null },
        include: { notas: { select: { ambiente: true, status: true, chaveAcesso: true } } } });
      if (!source) throw Object.assign(new Error('Venda de origem indisponível para esta empresa e tomador.'), { status: 403 });
      const originalJob = await tx.emissaoJob.findFirst({ where: { vendaId: source.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { ambiente: true, status: true, authorizedXmlBase64: true } });
      const hasHomologation = source.notas.some((note) => note.ambiente === 'HOMOLOGACAO' && ['AUTORIZADA', 'CANCELADA'].includes(note.status)) ||
        (originalJob?.ambiente === 'HOMOLOGACAO' && originalJob.status === 'AUTORIZADA' && !!originalJob.authorizedXmlBase64);
      const unsafeNote = source.notas.some((note) => note.ambiente !== 'HOMOLOGACAO' && (note.chaveAcesso || ['AUTORIZADA', 'CANCELADA'].includes(note.status)));
      if (!hasHomologation || unsafeNote || (originalJob && (originalJob.status !== 'AUTORIZADA' || originalJob.ambiente !== 'HOMOLOGACAO'))) {
        throw Object.assign(new Error('Esta origem não é uma emissão de homologação concluída, ou tem outra tentativa pendente. Confira o histórico.'), { status: 409 });
      }
    }
    if (payload.vendaId) {
      const sale = await tx.venda.findFirst({ where: { id: payload.vendaId, empresaId: prestador.id, arquivadoEm: null } });
      if (!sale || sale.clienteId !== tomador.id) throw Object.assign(new Error('Venda não pertence ao tomador e à empresa selecionados.'), { status: 403 });
      const previousJob = await tx.emissaoJob.findFirst({ where: { vendaId: sale.id }, orderBy: { createdAt: 'desc' } });
      const authorized = await tx.notaFiscal.findFirst({ where: { vendaId: sale.id, status: { in: ['AUTORIZADA', 'CANCELADA'] } }, select: { id: true } });
      if (authorized || (previousJob && previousJob.status !== 'ERRO_FINAL') || sale.status === 'HOMOLOGACAO_VALIDADA') {
        throw Object.assign(new Error('Venda já autorizada ou com emissão em andamento. Consulte o resultado antes de reenviar.'), { status: 409 });
      }
      if (previousJob?.creditReservationId) {
        const oldCredit = await tx.emissionCreditReservation.findUnique({ where: { id: previousJob.creditReservationId }, select: { status: true } });
        if (oldCredit?.status === 'RESERVED') throw Object.assign(new Error('Retorno fiscal ainda não conciliado. Não é seguro reenviar.'), { status: 409 });
      }
      if (previousJob?.status === 'ERRO_FINAL' && !previousJob.creditReservationId && previousJob.transmissionStartedAt) {
        throw Object.assign(new Error('Emissão legada com transmissão registrada. Concilie o retorno antes de criar outra tentativa.'), { status: 409 });
      }
    }
    // A nova solicitação só pode alcançar qualquer reserva ou gravação
    // comercial depois de passar pela mesma decisão fiscal usada pelo worker.
    // O worker repete a validação para proteger contra alterações concorrentes
    // nas regras entre o agendamento e a transmissão.
    await resolveEmissionFiscalContext({
      payload,
      prestador: currentCompany,
      tomador: currentCustomer,
      valorFloat,
    }, tx);
    const frozenSeries = normalizeDpsSeries(payload.serieDPS ?? currentCompany.serieDPS);
    const reservation = prestador.ambiente === 'PRODUCAO'
      ? await reserveEmissionCreditInTransaction(tx, billingUserId, `${empresaIdAlvo}:${idempotencyKey}`)
      : { ...await checkPlanLimits(billingUserId, 'EMITIR', tx), reserved: false, reservationId: null };
    if (!reservation.allowed) throw Object.assign(new Error(reservation.reason || 'Plano sem créditos de emissão.'), { status: 403, code: reservation.status });
    const venda = payload.vendaId
      ? await tx.venda.update({ where: { id: payload.vendaId }, data: { valor: valorFloat, descricao: payload.descricao, status: 'PROCESSANDO' } })
      : await tx.venda.create({ data: { empresaId: prestador.id, clienteId: tomador.id, valor: valorFloat, descricao: payload.descricao, status: 'PROCESSANDO' } });
    const job = await tx.emissaoJob.create({ data: {
      empresaId: prestador.id, clienteId: tomador.id, vendaId: venda.id, actorUserId: user.id, billingUserId,
      ambiente: prestador.ambiente,
      payloadJson: JSON.stringify({ ...payload, _requestPayload: payload, _tomadorSnapshot: frozenCustomerSnapshot(currentCustomer),
        _creditReserved: reservation.reserved }), status: 'PENDENTE',
      statusMessage: 'Emissão registrada. Aguardando processamento.', maxAttempts: getIntEnv('EMISSION_MAX_ATTEMPTS', 5),
      partitionKey: getPartitionKey(prestador.id), idempotencyKey, reservedPlanHistoryId: reservation.historyId || null,
      creditReservationId: reservation.reservationId, billingUnlimited: reservation.unlimited === true,
      serieDPS: frozenSeries, source: params.source || 'WEB',
    } });
    await tx.systemLog.create({ data: { level: 'INFO', action: 'EMISSAO_JOB_CRIADO', message: 'Emissão e reserva registradas atomicamente.',
      empresaId: prestador.id, vendaId: venda.id, userId: user.id,
      details: JSON.stringify({ jobId: job.id, billingUserId, reservationId: reservation.reservationId, copiaDeVendaId: payload.copiaDeVendaId || null }) } });
    return { job, venda, existing: false };
  });
}

export async function prepararEmissaoJob(job: any) {
  const payload = JSON.parse(job.payloadJson || '{}');
  const user = await prisma.user.findUnique({ where: { id: job.actorUserId } });
  const prestador = await prisma.empresa.findUnique({ where: { id: job.empresaId } });
  const currentCustomer = await findTenantCustomer(job.clienteId, job.empresaId);
  const tomador = currentCustomer && payload._tomadorSnapshot && typeof payload._tomadorSnapshot === 'object' && !Array.isArray(payload._tomadorSnapshot)
    ? { ...currentCustomer, ...payload._tomadorSnapshot } : currentCustomer;
  const venda = job.vendaId ? await prisma.venda.findUnique({ where: { id: job.vendaId } }) : null;

  if (!user || !prestador || !tomador || !venda) {
    throw new Error('Job de emissao sem usuario, empresa, tomador ou venda vinculado.');
  }
  if (prestador.ambiente !== job.ambiente) throw Object.assign(new Error('Ambiente alterado após o agendamento. Revise a solicitação.'), { status: 400 });
  if (job.ambiente === 'PRODUCAO') {
    const reservation = job.creditReservationId ? await prisma.emissionCreditReservation.findUnique({ where: { id: job.creditReservationId } }) : null;
    if (!reservation || reservation.status !== 'RESERVED' || reservation.userId !== job.billingUserId) {
      throw Object.assign(new Error('Reserva de crédito ausente ou encerrada. Concilie o pedido antes de transmitir.'), { status: 400 });
    }
  }
  // Protege jobs antigos que tenham sido enfileirados antes da obrigatoriedade.
  assertTomadorPfComEndereco(tomador);

  const valorFloat = parseNumero(payload.valor);
  // The sequence reservation freezes the series. A later settings change must
  // never produce XML for another series with the same reserved number.
  const serieFinal = normalizeDpsSeries(job.serieDPS);
  const dpsFinal = job.reservedDpsNumero;
  if (!Number.isSafeInteger(dpsFinal) || dpsFinal < 1) throw new Error('DPS não reservada pelo worker.');

  const {
    cnaeFinal,
    codigoTribNacional,
    itemLc,
    codigoNbs,
    codigoTributacaoMunicipal,
    cadastroPf,
    tomadorTipo,
    tomadorPais,
    fiscalDecision,
    aliquotaIss,
    aliquotaMunicipioNumero,
    tipoTributacao,
  } = await resolveEmissionFiscalContext({ payload, prestador, tomador, valorFloat });

  const prestadorEmissao = {
    ...prestador,
    inscricaoMunicipal: optionalString(firstDefined(payload.inscricaoMunicipalPrestador, prestador.inscricaoMunicipal)),
    regimeEspecialTributacao: optionalString(firstDefined(payload.regimeEspecialTributacao, prestador.regimeEspecialTributacao)),
    tipoTributacaoPadrao: tipoTributacao || prestador.tipoTributacaoPadrao,
    // The service location cannot change the issuer identity or DPS identifier.
    codigoIbge: prestador.codigoIbge,
  };

  const enderecoCadastroOuOverride = (override: any, cadastro: any) => cadastroPf
    ? optionalString(cadastro) || ''
    : optionalString(firstDefined(override, cadastro)) || '';
  const tomadorAdaptado = {
    ...tomador,
    razaoSocial: optionalString(firstDefined(payload.tomadorNome, tomador.nome)) || tomador.nome,
    nome: optionalString(firstDefined(payload.tomadorNome, tomador.nome)) || tomador.nome,
    documento: optionalString(firstDefined(payload.tomadorDocumento, tomador.documento)) || '',
    inscricaoMunicipal: optionalString(firstDefined(payload.tomadorInscricaoMunicipal, tomador.inscricaoMunicipal)),
    email: optionalString(firstDefined(payload.tomadorEmail, tomador.email)),
    telefone: optionalString(firstDefined(payload.tomadorTelefone, tomador.telefone)),
    codigoIbge: enderecoCadastroOuOverride(payload.tomadorCodigoIbge, tomador.codigoIbge),
    tipo: tomadorTipo,
    nif: optionalString(firstDefined(payload.tomadorNif, tomador.nif)),
    pais: tomadorPais,
    moeda: optionalString(firstDefined(payload.tomadorMoeda, tomador.moeda)),
    semEndereco: false,
    cep: enderecoCadastroOuOverride(payload.tomadorCep, tomador.cep),
    logradouro: enderecoCadastroOuOverride(payload.tomadorLogradouro, tomador.logradouro),
    numero: enderecoCadastroOuOverride(payload.tomadorNumero, tomador.numero),
    complemento: cadastroPf ? optionalString(tomador.complemento) : optionalString(firstDefined(payload.tomadorComplemento, tomador.complemento)),
    bairro: enderecoCadastroOuOverride(payload.tomadorBairro, tomador.bairro),
    cidade: enderecoCadastroOuOverride(payload.tomadorCidade, tomador.cidade),
    uf: enderecoCadastroOuOverride(payload.tomadorUf, tomador.uf),
    endereco: {
      cep: enderecoCadastroOuOverride(payload.tomadorCep, tomador.cep),
      logradouro: enderecoCadastroOuOverride(payload.tomadorLogradouro, tomador.logradouro),
      numero: enderecoCadastroOuOverride(payload.tomadorNumero, tomador.numero),
      complemento: cadastroPf ? optionalString(tomador.complemento) : optionalString(firstDefined(payload.tomadorComplemento, tomador.complemento)),
      bairro: enderecoCadastroOuOverride(payload.tomadorBairro, tomador.bairro),
      cidade: enderecoCadastroOuOverride(payload.tomadorCidade, tomador.cidade),
      codigoIbge: enderecoCadastroOuOverride(payload.tomadorCodigoIbge, tomador.codigoIbge),
      uf: enderecoCadastroOuOverride(payload.tomadorUf, tomador.uf),
    },
  };

  const dadosParaEstrategia = {
    prestador: prestadorEmissao,
    tomador: tomadorAdaptado,
    venda,
    servico: {
      valor: valorFloat,
      localPrestacaoIbge: optionalString(firstDefined(payload.localPrestacaoIbge, prestador.codigoIbge)),
      valorMoedaEstrangeira: firstDefined(payload.valorMoedaEstrangeira) ? parseNumero(payload.valorMoedaEstrangeira) : undefined,
      codigoNbs,
      codigoTributacaoMunicipal,
      aliquotaMunicipio: aliquotaMunicipioNumero,
      aliquotaTotTribSN: fiscalDecision.aliquotaTotTribSN,
      aliquotaTotTribFederal: fiscalDecision.aliquotaTotTribFederal,
      cstPisCofins: fiscalDecision.cstPisCofins,
      descricao: payload.descricao,
      cnae: cnaeFinal,
      itemLc,
      itemListaServico: itemLc,
      codigoTribNacional,
      codigoTributacaoNacional: codigoTribNacional,
      aliquota: aliquotaIss,
      issRetido: parseBoolean(payload.issRetido, false),
      tipoTributacao: tipoTributacao || '1',
      retencoes: fiscalDecision.retencoes,
      tributosFederaisDevidos: fiscalDecision.tributosFederaisDevidos,
      ibscbs: fiscalDecision.ibscbs,
      dataCompetencia: payload.dataCompetencia,
    },
    ambiente: prestadorEmissao.ambiente as 'HOMOLOGACAO' | 'PRODUCAO',
    numeroDPS: dpsFinal,
    serieDPS: serieFinal,
    dataCompetencia: payload.dataCompetencia,
    layoutVersion: fiscalDecision.layoutVersion,
    fiscalSnapshot: fiscalDecision,
  };

  const signedXml = await EmissorFactory.getStrategy(prestador).preparar(dadosParaEstrategia);
  return { signedXml, fiscalSnapshotJson: JSON.stringify(fiscalDecision), metadata: {
    valor: valorFloat, descricao: payload.descricao, cnae: cnaeFinal,
    prestadorDocumento: prestador.documento, tomadorDocumento: tomadorAdaptado.documento || 'EXTERIOR',
  } };
}
