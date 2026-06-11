import { PrismaClient } from '@prisma/client';
import { createLog } from '@/app/services/logger';
import { EmissorFactory } from '@/app/services/emissor/factories/EmissorFactory';
import { getTributacaoPorCnae } from '@/app/utils/tributacao';
import { processarRetornoNota } from '@/app/services/notaProcessor';
import { checkPlanLimits, incrementUsage, resolveBillingUserId } from '@/app/services/planService';

const prisma = new PrismaClient();
const emissaoJobModel = (prisma as any).emissaoJob;

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getIntEnv(name: string, fallback: number) {
  const valor = Number(process.env[name]);
  return Number.isFinite(valor) && valor > 0 ? valor : fallback;
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

function textoErroFiscal(resultado: any) {
  return JSON.stringify({
    motivo: resultado?.motivo,
    erros: resultado?.erros,
  }).toLowerCase();
}

function isErroTemporarioPortal(resultado: any) {
  const errorStr = textoErroFiscal(resultado);
  return [
    'e999',
    'e0008',
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
  ].some((sinal) => errorStr.includes(sinal));
}

async function getEmpresaContexto(user: any, contextId: string | null) {
  const isStaff = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(user.role);

  if (contextId && contextId !== 'null' && contextId !== 'undefined') {
    if (isStaff) return contextId;
    if (contextId === user.empresaId) return contextId;

    const colaborador = await prisma.userCliente.findUnique({
      where: { userId_empresaId: { userId: user.id, empresaId: contextId } },
    });
    if (colaborador) return contextId;

    const vinculo = await prisma.contadorVinculo.findUnique({
      where: { contadorId_empresaId: { contadorId: user.id, empresaId: contextId } },
    });
    if (vinculo && vinculo.status === 'APROVADO' && !(vinculo as any).arquivadoEm) return contextId;

    return null;
  }

  return user.empresaId;
}

function normalizarPayload(body: any) {
  const {
    clienteId,
    valor,
    descricao,
    codigoCnae,
    vendaId,
    aliquota,
    issRetido,
    retencoes,
    numeroDPS,
    serieDPS,
    valorMoedaEstrangeira,
    dataCompetencia,
    idempotencyKey,
  } = body;

  return {
    clienteId,
    valor,
    descricao,
    codigoCnae,
    vendaId,
    aliquota,
    issRetido,
    retencoes,
    numeroDPS,
    serieDPS,
    valorMoedaEstrangeira,
    dataCompetencia,
    idempotencyKey,
  };
}

function montarErroFinal(resultado: any, dpsFinal: number, tentativasEmissao: number) {
  let customUserAction = null;
  let draftEligible = false;
  let draftReasonType = null;
  let discardVenda = false;
  const errorStr = textoErroFiscal(resultado);

  if (isErroTemporarioPortal(resultado)) {
    customUserAction = `Portal Nacional indisponivel no momento. Tentamos ${tentativasEmissao} vez(es) usando a mesma DPS ${dpsFinal}, mas o servico nao respondeu corretamente. Aguarde alguns minutos e tente reenviar.`;
  } else if (errorStr.includes('inscrição municipal') || errorStr.includes('inscriÃ§Ã£o municipal') || errorStr.includes('im ') || errorStr.includes('e0180') || errorStr.includes('e0183') || errorStr.includes('e0184')) {
    customUserAction = 'Sua Inscricao Municipal esta ausente ou incorreta. Por favor, acesse as Configuracoes da Empresa e atualize o numero da sua I.M.';
    draftEligible = true;
    draftReasonType = 'INSCRICAO_MUNICIPAL';
    discardVenda = true;
  } else if (errorStr.includes('já utilizado') || errorStr.includes('jÃ¡ utilizado') || errorStr.includes('já existe') || errorStr.includes('jÃ¡ existe') || errorStr.includes('duplicado') || errorStr.includes('e0171') || errorStr.includes('e0041')) {
    customUserAction = `O numero de DPS ${dpsFinal} ja foi utilizado. Por favor, altere o numero do DPS para o proximo sequencial disponivel.`;
    draftEligible = true;
    draftReasonType = 'DPS_DUPLICADO';
    discardVenda = true;
  }

  return {
    error: 'Emissao falhou.',
    details: resultado?.erros,
    motivo: resultado?.motivo || 'Rejeicao Sefaz',
    userAction: customUserAction,
    draftEligible,
    draftReasonType,
    discardVenda,
    temporario: isErroTemporarioPortal(resultado),
  };
}

export async function criarEmissaoJob(params: CriarEmissaoJobParams): Promise<CriarEmissaoJobResult> {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) throw Object.assign(new Error('Usuario nao autenticado.'), { status: 401 });

  const payload = normalizarPayload(params.body);
  const empresaIdAlvo = await getEmpresaContexto(user, params.contextId);
  if (!empresaIdAlvo) throw Object.assign(new Error('Acesso negado a empresa selecionada.'), { status: 403 });

  const idempotencyKey = params.idempotencyKey || payload.idempotencyKey || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const existing = await emissaoJobModel.findUnique({
    where: { empresaId_idempotencyKey: { empresaId: empresaIdAlvo, idempotencyKey } },
  });
  if (existing) {
    const vendaExistente = existing.vendaId ? await prisma.venda.findUnique({ where: { id: existing.vendaId } }) : null;
    return { job: existing, venda: vendaExistente, existing: true };
  }

  const prestador = await prisma.empresa.findUnique({ where: { id: empresaIdAlvo } });
  if (!prestador || !prestador.documento) {
    throw Object.assign(new Error('Cadastro incompleto.'), {
      status: 400,
      userAction: 'Voce ainda nao concluiu o cadastro da sua Empresa. Acesse as Configuracoes para preencher seus dados basicos.',
    });
  }

  if (!prestador.certificadoA1) {
    throw Object.assign(new Error('Certificado nao encontrado.'), {
      status: 400,
      userAction: 'Para emitir notas, voce precisa de um Certificado Digital (e-CNPJ). Acesse as Configuracoes da Empresa e faca o upload do seu certificado A1.',
    });
  }

  const tomador = await prisma.cliente.findUnique({ where: { id: payload.clienteId } });
  if (!tomador) throw Object.assign(new Error('Tomador (Cliente) nao encontrado.'), { status: 400 });

  let billingUserId = await resolveBillingUserId({
    empresaId: empresaIdAlvo,
    actorUserId: user.id,
    acao: 'EMITIR',
  });

  if (!billingUserId) {
    const donoEmpresa = await prisma.user.findFirst({
      where: { empresaId: empresaIdAlvo, role: { notIn: ['CONTADOR', 'SUPORTE', 'SUPORTE_TI'] } },
      orderBy: { createdAt: 'asc' },
    });
    if (donoEmpresa) billingUserId = donoEmpresa.id;
  }

  let planHistoryId: string | null = null;
  if (billingUserId) {
    const planCheck = await checkPlanLimits(billingUserId, 'EMITIR');
    if (!planCheck.allowed) {
      throw Object.assign(new Error('Limite de emissao atingido.'), {
        status: 403,
        userAction: 'A carteira de consumo responsavel por este CNPJ atingiu o limite ou o plano expirou.',
        code: planCheck.status,
      });
    }
    planHistoryId = planCheck.historyId || null;
  }

  const valorFloat = parseFloat(payload.valor);
  if (!Number.isFinite(valorFloat) || valorFloat <= 0) {
    throw Object.assign(new Error('Valor da nota invalido.'), { status: 400 });
  }

  const venda = payload.vendaId
    ? await prisma.venda.update({
        where: { id: payload.vendaId },
        data: { valor: valorFloat, descricao: payload.descricao, status: 'PROCESSANDO' },
      })
    : await prisma.venda.create({
        data: {
          empresaId: prestador.id,
          clienteId: tomador.id,
          valor: valorFloat,
          descricao: payload.descricao,
          status: 'PROCESSANDO',
        },
      });

  const job = await emissaoJobModel.create({
    data: {
      empresaId: prestador.id,
      clienteId: tomador.id,
      vendaId: venda.id,
      actorUserId: user.id,
      billingUserId,
      payloadJson: JSON.stringify(payload),
      status: 'PENDENTE',
      statusMessage: 'Emissao registrada. Aguardando processamento.',
      maxAttempts: getIntEnv('EMISSION_MAX_ATTEMPTS', 5),
      partitionKey: getPartitionKey(prestador.id),
      idempotencyKey,
      reservedPlanHistoryId: planHistoryId,
      serieDPS: payload.serieDPS || prestador.serieDPS || '900',
      source: params.source || 'WEB',
    },
  });

  await createLog({
    level: 'INFO',
    action: 'EMISSAO_JOB_CRIADO',
    message: 'Pedido de emissao registrado na fila.',
    empresaId: prestador.id,
    vendaId: venda.id,
    details: { jobId: job.id, partitionKey: job.partitionKey, idempotencyKey },
  });

  return { job, venda, existing: false };
}

async function adquirirLockEmpresa(empresaId: string) {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext(${empresaId})) AS locked
  `;
  return rows?.[0]?.locked === true;
}

async function liberarLockEmpresa(empresaId: string) {
  await prisma.$queryRaw`
    SELECT pg_advisory_unlock(hashtext(${empresaId}))
  `;
}

async function agendarNovaTentativa(jobId: string, delayMs: number) {
  setTimeout(() => {
    processarEmissaoJob(jobId).catch((error) => console.error('[EMISSAO_JOB] retry falhou:', error));
  }, delayMs);
}

export function dispararProcessamentoEmissaoJob(jobId: string) {
  setTimeout(() => {
    processarEmissaoJob(jobId).catch((error) => console.error('[EMISSAO_JOB] processamento falhou:', error));
  }, 50);
}

async function processarProximoDaEmpresa(empresaId: string) {
  const nextJob = await emissaoJobModel.findFirst({
    where: {
      empresaId,
      status: 'PENDENTE',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (nextJob) dispararProcessamentoEmissaoJob(nextJob.id);
}

export async function processarEmissaoJob(jobId: string) {
  const job = await emissaoJobModel.findUnique({ where: { id: jobId } });
  if (!job || !['PENDENTE', 'ERRO_TEMPORARIO'].includes(job.status)) return;

  const locked = await adquirirLockEmpresa(job.empresaId);
  if (!locked) return;

  try {
    const lockedJob = await emissaoJobModel.update({
      where: { id: job.id },
      data: {
        status: 'PROCESSANDO',
        statusMessage: 'Processando emissao no Portal Nacional.',
        attempts: { increment: 1 },
        startedAt: job.startedAt || new Date(),
        lockedAt: new Date(),
        lockedBy: `next-${process.pid}`,
        lastError: null,
      },
    });

    await executarEmissao(lockedJob);
  } finally {
    await liberarLockEmpresa(job.empresaId);
    await processarProximoDaEmpresa(job.empresaId);
  }
}

async function executarEmissao(job: any) {
  const payload = JSON.parse(job.payloadJson || '{}');
  const user = await prisma.user.findUnique({ where: { id: job.actorUserId } });
  const prestador = await prisma.empresa.findUnique({ where: { id: job.empresaId } });
  const tomador = await prisma.cliente.findUnique({ where: { id: job.clienteId } });
  const venda = job.vendaId ? await prisma.venda.findUnique({ where: { id: job.vendaId } }) : null;

  if (!user || !prestador || !tomador || !venda) {
    throw new Error('Job de emissao sem usuario, empresa, tomador ou venda vinculado.');
  }

  const valorFloat = parseFloat(payload.valor);
  const serieFinal = payload.serieDPS || prestador.serieDPS || '900';
  const dpsFinal = payload.numeroDPS ? parseInt(payload.numeroDPS) : (prestador.ultimoDPS || 0) + 1;

  await emissaoJobModel.update({
    where: { id: job.id },
    data: {
      statusMessage: `Transmitindo DPS ${dpsFinal} ao Portal Nacional.`,
      reservedDpsNumero: dpsFinal,
      serieDPS: serieFinal,
    },
  });

  let cnaeFinal = payload.codigoCnae ? String(payload.codigoCnae).replace(/\D/g, '') : '';
  if (!cnaeFinal) {
    const cnaeBanco = await prisma.cnae.findFirst({ where: { empresaId: prestador.id, principal: true } });
    if (cnaeBanco) cnaeFinal = cnaeBanco.codigo.replace(/\D/g, '');
  }
  if (!cnaeFinal) throw new Error('CNAE e obrigatorio para emissao.');

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

  const regraGlobal = await prisma.globalCnae.findUnique({ where: { codigo: cnaeFinal } });
  if (regraGlobal) {
    if (regraGlobal.itemLc) itemLc = regraGlobal.itemLc;
    if (regraGlobal.codigoTributacaoNacional) codigoTribNacional = regraGlobal.codigoTributacaoNacional.replace(/\D/g, '');
    if ((regraGlobal as any).codigoNbs) nbsEncontrado = (regraGlobal as any).codigoNbs;
  }

  const regraMunicipal = await prisma.tributacaoMunicipal.findFirst({
    where: {
      cnae: cnaeFinal,
      codigoIbge: prestador.codigoIbge || '',
    },
  });

  if (regraMunicipal?.exigeNbs && nbsEncontrado) {
    codigoNbs = nbsEncontrado;
  }

  const semEnderecoTomador = tomador.tipo === 'PF' && (tomador as any).semEndereco === true;
  const tomadorAdaptado = {
    ...tomador,
    razaoSocial: tomador.nome,
    documento: tomador.documento || '',
    inscricaoMunicipal: tomador.inscricaoMunicipal ? String(tomador.inscricaoMunicipal) : undefined,
    codigoIbge: semEnderecoTomador ? '' : tomador.codigoIbge || '9999999',
    tipo: tomador.tipo,
    nif: tomador.nif,
    pais: tomador.pais,
    moeda: tomador.moeda,
    semEndereco: semEnderecoTomador,
    endereco: {
      cep: semEnderecoTomador ? '' : tomador.cep || '',
      logradouro: semEnderecoTomador ? '' : tomador.logradouro || '',
      numero: semEnderecoTomador ? '' : tomador.numero || '',
      bairro: semEnderecoTomador ? '' : tomador.bairro || '',
      cidade: semEnderecoTomador ? '' : tomador.cidade || '',
      codigoIbge: semEnderecoTomador ? '' : tomador.codigoIbge || '9999999',
      uf: semEnderecoTomador ? '' : tomador.uf || '',
    },
  };

  const dadosParaEstrategia = {
    prestador,
    tomador: tomadorAdaptado,
    venda,
    servico: {
      valor: valorFloat,
      valorMoedaEstrangeira: payload.valorMoedaEstrangeira ? parseFloat(payload.valorMoedaEstrangeira) : undefined,
      codigoNbs,
      codigoTributacaoMunicipal: regraMunicipal?.codigoTributacaoMunicipal,
      aliquotaMunicipio: regraMunicipal?.aliquotaIss ? Number(regraMunicipal.aliquotaIss) : null,
      descricao: payload.descricao,
      cnae: cnaeFinal,
      itemLc,
      codigoTribNacional,
      aliquota: payload.aliquota ? parseFloat(payload.aliquota) : 0,
      issRetido: !!payload.issRetido,
      retencoes: payload.retencoes,
    },
    ambiente: prestador.ambiente as 'HOMOLOGACAO' | 'PRODUCAO',
    numeroDPS: dpsFinal,
    serieDPS: serieFinal,
    dataCompetencia: payload.dataCompetencia,
  };

  const strategy = EmissorFactory.getStrategy(prestador);
  let resultado: any;
  let tentativasEmissao = 0;
  const tentativasPortal = getIntEnv('EMISSION_PORTAL_ATTEMPTS', 5);

  for (let tentativa = 1; tentativa <= tentativasPortal; tentativa++) {
    tentativasEmissao = tentativa;
    resultado = await strategy.executar(dadosParaEstrategia);

    if (!resultado.sucesso && isErroTemporarioPortal(resultado) && tentativa < tentativasPortal) {
      await sleep(getIntEnv('EMISSION_RETRY_BACKOFF_MS', 3000) + tentativa * 1500);
      continue;
    }
    break;
  }

  await createLog({
    level: 'INFO',
    action: 'EMISSAO_INICIADA',
    message: `Iniciando transmissao DPS ${dpsFinal} (Serie ${serieFinal}) - Ambiente: ${prestador.ambiente}.`,
    empresaId: prestador.id,
    vendaId: venda.id,
    details: { payloadOriginal: dadosParaEstrategia, xmlGerado: resultado?.xmlGerado, jobId: job.id },
  });

  if (!resultado?.sucesso) {
    const erro = montarErroFinal(resultado, dpsFinal, tentativasEmissao);
    const attempts = job.attempts || 1;

    if (erro.temporario && attempts < (job.maxAttempts || 5)) {
      const delayMs = getIntEnv('EMISSION_RETRY_BACKOFF_MS', 5000) * attempts;
      await emissaoJobModel.update({
        where: { id: job.id },
        data: {
          status: 'ERRO_TEMPORARIO',
          statusMessage: 'Portal Nacional instavel. Nova tentativa sera feita automaticamente.',
          lastError: JSON.stringify(erro),
          nextAttemptAt: new Date(Date.now() + delayMs),
        },
      });
      await createLog({
        level: 'ALERTA',
        action: 'EMISSAO_JOB_RETRY',
        message: 'Falha temporaria na emissao. Job reagendado.',
        empresaId: prestador.id,
        vendaId: venda.id,
        details: { jobId: job.id, attempts, delayMs, erro },
      });
      await agendarNovaTentativa(job.id, delayMs);
      return;
    }

    if (erro.discardVenda && !payload.vendaId) {
      await prisma.venda.update({
        where: { id: venda.id },
        data: {
          status: 'DESCARTADA',
          arquivadoEm: new Date(),
          arquivadoPor: user.id,
          motivoArquivamento: 'Emissao descartada apos falha validada.',
        } as any,
      });
    } else {
      await prisma.venda.update({ where: { id: venda.id }, data: { status: 'ERRO_EMISSAO' } });
    }

    await createLog({
      level: 'ERRO',
      action: 'FALHA_EMISSAO',
      message: erro.motivo || 'Rejeicao Sefaz',
      empresaId: prestador.id,
      vendaId: venda.id,
      details: {
        erros: resultado.erros,
        tentativas: tentativasEmissao,
        dpsPreservada: isErroTemporarioPortal(resultado),
        numeroDPS: dpsFinal,
        serieDPS: serieFinal,
        jobId: job.id,
      },
    });

    await emissaoJobModel.update({
      where: { id: job.id },
      data: {
        status: 'ERRO_FINAL',
        statusMessage: erro.userAction || erro.motivo || 'A emissao falhou.',
        lastError: JSON.stringify(erro),
        finishedAt: new Date(),
      },
    });
    return;
  }

  if (prestador.ambiente === 'HOMOLOGACAO') {
    if (!payload.vendaId) {
      await prisma.venda.update({
        where: { id: venda.id },
        data: {
          status: 'DESCARTADA',
          arquivadoEm: new Date(),
          arquivadoPor: user.id,
          motivoArquivamento: 'Homologacao validada sem gerar nota fiscal.',
        } as any,
      });
    }

    await emissaoJobModel.update({
      where: { id: job.id },
      data: {
        status: 'AUTORIZADA',
        statusMessage: 'Validacao concluida em homologacao.',
        finishedAt: new Date(),
      },
    });
    return;
  }

  if (job.reservedPlanHistoryId) await incrementUsage(job.reservedPlanHistoryId);

  if (prestador.ambiente === 'PRODUCAO' && dpsFinal > (prestador.ultimoDPS || 0)) {
    await prisma.empresa.update({ where: { id: prestador.id }, data: { ultimoDPS: dpsFinal } });
  }

  const nota = await prisma.notaFiscal.create({
    data: {
      vendaId: venda.id,
      empresaId: prestador.id,
      clienteId: tomador.id,
      numero: parseInt(resultado.notaGov!.numero) || 0,
      valor: valorFloat,
      descricao: payload.descricao,
      prestadorCnpj: prestador.documento.replace(/\D/g, ''),
      tomadorCnpj: tomador.documento ? tomador.documento.replace(/\D/g, '') : 'EXTERIOR',
      status: 'AUTORIZADA',
      chaveAcesso: resultado.notaGov!.chave,
      protocolo: resultado.notaGov!.protocolo,
      xmlBase64: resultado.notaGov!.xml,
      xmlAutorizadoBase64: resultado.notaGov!.xml,
      cnae: cnaeFinal,
      dataEmissao: new Date(),
    } as any,
  });

  await createLog({
    level: 'INFO',
    action: 'NOTA_AUTORIZADA',
    message: nota.numero && nota.numero > 0 ? `Nota ${nota.numero} autorizada!` : 'Nota autorizada. Aguardando numero oficial do XML de distribuicao.',
    empresaId: prestador.id,
    vendaId: venda.id,
    details: {
      numeroDPS: dpsFinal,
      serieDPS: serieFinal,
      tentativas: tentativasEmissao,
      chaveAcesso: resultado.notaGov!.chave,
      jobId: job.id,
    },
  });

  await emissaoJobModel.update({
    where: { id: job.id },
    data: {
      status: 'AUTORIZADA',
      statusMessage: 'Nota autorizada. Sincronizando XML e PDF oficiais.',
      resultNotaId: nota.id,
      finishedAt: new Date(),
    },
  });

  processarRetornoNota(nota.id, prestador.id, venda.id).catch(console.error);
}
