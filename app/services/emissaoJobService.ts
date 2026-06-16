import { PrismaClient } from '@prisma/client';
import { createLog } from '@/app/services/logger';
import { EmissorFactory } from '@/app/services/emissor/factories/EmissorFactory';
import { getTributacaoPorCnae } from '@/app/utils/tributacao';
import { processarRetornoNota } from '@/app/services/notaProcessor';
import { checkPlanLimits, incrementUsage, releaseEmissionCredit, reserveEmissionCredit, resolveBillingUserId } from '@/app/services/planService';
import { resolveEmpresaContexto } from '@/app/utils/access-control';
import { notifyFiscalEvent } from '@/app/services/notificationService';

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

function parsePayloadSeguro(payloadJson?: string | null) {
  if (!payloadJson) return {};
  try {
    return JSON.parse(payloadJson);
  } catch {
    return {};
  }
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
  const empresaIdAlvo = await resolveEmpresaContexto(user, params.contextId);
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
  let creditReserved = false;
  if (billingUserId) {
    const planCheck = prestador.ambiente === 'PRODUCAO'
      ? await reserveEmissionCredit(billingUserId)
      : await checkPlanLimits(billingUserId, 'EMITIR');

    if (!planCheck.allowed) {
      throw Object.assign(new Error('Limite de emissao atingido.'), {
        status: 403,
        userAction: 'A carteira de consumo responsavel por este CNPJ atingiu o limite ou o plano expirou.',
        code: planCheck.status,
      });
    }
    planHistoryId = planCheck.historyId || null;
    creditReserved = prestador.ambiente === 'PRODUCAO' && (planCheck as any).reserved === true;
  }

  const valorFloat = parseFloat(payload.valor);
  if (!Number.isFinite(valorFloat) || valorFloat <= 0) {
    throw Object.assign(new Error('Valor da nota invalido.'), { status: 400 });
  }

  let venda: any;
  let job: any;

  try {
    venda = payload.vendaId
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

    job = await emissaoJobModel.create({
      data: {
        empresaId: prestador.id,
        clienteId: tomador.id,
        vendaId: venda.id,
        actorUserId: user.id,
        billingUserId,
        payloadJson: JSON.stringify({ ...payload, _creditReserved: creditReserved }),
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
  } catch (error) {
    if (creditReserved) await releaseEmissionCredit(planHistoryId);
    throw error;
  }

  await createLog({
    level: 'INFO',
    action: 'EMISSAO_JOB_CRIADO',
    message: 'Pedido de emissao registrado na fila.',
    empresaId: prestador.id,
    vendaId: venda.id,
    details: { jobId: job.id, partitionKey: job.partitionKey, idempotencyKey, billingUserId, planHistoryId, creditReserved },
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

export async function retomarEmissoesPendentes(options: { limit?: number; recuperarTravados?: boolean } = {}) {
  const limit = Math.min(Math.max(options.limit || getIntEnv('EMISSION_RESUME_LIMIT', 25), 1), 100);
  const recuperarTravados = options.recuperarTravados !== false;
  const agora = new Date();
  const staleMinutes = getIntEnv('EMISSION_STALE_PROCESSING_MINUTES', 15);
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
  let travadosRecuperados = 0;

  if (recuperarTravados) {
    const jobsTravados = await emissaoJobModel.findMany({
      where: {
        status: 'PROCESSANDO',
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
      },
      orderBy: { lockedAt: 'asc' },
      take: limit,
    });

    for (const job of jobsTravados) {
      const attempts = job.attempts || 1;
      const maxAttempts = job.maxAttempts || 5;
      const podeTentar = attempts < maxAttempts;

      await emissaoJobModel.update({
        where: { id: job.id },
        data: {
          status: podeTentar ? 'ERRO_TEMPORARIO' : 'ERRO_FINAL',
          statusMessage: podeTentar
            ? 'Processamento anterior ficou sem conclusao. Job retomado para nova tentativa.'
            : 'Processamento anterior ficou sem conclusao e atingiu o limite de tentativas.',
          lastError: JSON.stringify({
            error: 'Job ficou travado em PROCESSANDO.',
            motivo: `Sem atualizacao ha mais de ${staleMinutes} minutos.`,
            temporario: podeTentar,
            userAction: podeTentar
              ? 'O sistema retomara a emissao automaticamente preservando a fila da empresa.'
              : 'Acione o suporte para revisar a emissao antes de tentar novamente.',
          }),
          nextAttemptAt: podeTentar ? agora : null,
          finishedAt: podeTentar ? null : agora,
          lockedAt: null,
          lockedBy: null,
        },
      });

      if (job.vendaId && !podeTentar) {
        await prisma.venda.update({ where: { id: job.vendaId }, data: { status: 'ERRO_EMISSAO' } });
      }

      if (!podeTentar) {
        const payload = parsePayloadSeguro(job.payloadJson);
        if (payload._creditReserved === true && !job.reservedDpsNumero) {
          await releaseEmissionCredit(job.reservedPlanHistoryId);
        }
      }

      travadosRecuperados++;

      await createLog({
        level: podeTentar ? 'ALERTA' : 'ERRO',
        action: podeTentar ? 'EMISSAO_JOB_TRAVADO_RETOMADO' : 'EMISSAO_JOB_TRAVADO_FINAL',
        message: podeTentar
          ? 'Job travado em processamento foi devolvido para retry.'
          : 'Job travado em processamento foi finalizado por limite de tentativas.',
        empresaId: job.empresaId,
        vendaId: job.vendaId,
        details: { jobId: job.id, attempts, maxAttempts, staleMinutes, reservedDpsNumero: job.reservedDpsNumero },
      });
    }
  }

  const jobsDevidos = await emissaoJobModel.findMany({
    where: {
      status: { in: ['PENDENTE', 'ERRO_TEMPORARIO'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: agora } }],
    },
    orderBy: [{ createdAt: 'asc' }],
    take: limit,
  });

  const empresasAcionadas = new Set<string>();
  for (const job of jobsDevidos) {
    if (empresasAcionadas.has(job.empresaId)) continue;
    empresasAcionadas.add(job.empresaId);
    await processarProximoDaEmpresa(job.empresaId);
  }

  return {
    travadosRecuperados,
    jobsDevidos: jobsDevidos.length,
    empresasAcionadas: empresasAcionadas.size,
  };
}

async function processarProximoDaEmpresa(empresaId: string) {
  const retryPendente = await emissaoJobModel.findFirst({
    where: {
      empresaId,
      status: 'ERRO_TEMPORARIO',
    },
    orderBy: { createdAt: 'asc' },
  });

  if (retryPendente) {
    const retryDue = !retryPendente.nextAttemptAt || new Date(retryPendente.nextAttemptAt) <= new Date();
    if (retryDue) {
      dispararProcessamentoEmissaoJob(retryPendente.id);
    }
    return;
  }

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
    let lockedJob = job;

    if (job.status === 'PENDENTE') {
      const bloqueioAnterior = await emissaoJobModel.findFirst({
        where: {
          empresaId: job.empresaId,
          status: 'ERRO_TEMPORARIO',
          createdAt: { lt: job.createdAt },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (bloqueioAnterior) {
        await createLog({
          level: 'ALERTA',
          action: 'EMISSAO_JOB_BLOQUEADO_POR_RETRY',
          message: 'Job pendente bloqueado por emissao anterior com erro temporario.',
          empresaId: job.empresaId,
          vendaId: job.vendaId,
          details: {
            jobId: job.id,
            jobBloqueadorId: bloqueioAnterior.id,
            reservedDpsNumero: bloqueioAnterior.reservedDpsNumero,
            nextAttemptAt: bloqueioAnterior.nextAttemptAt,
          },
        });
        return;
      }
    }

    lockedJob = await emissaoJobModel.update({
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

    try {
      await executarEmissao(lockedJob);
    } catch (error: any) {
      await registrarFalhaInesperadaJob(lockedJob.id, error);
    }
  } finally {
    await liberarLockEmpresa(job.empresaId);
    await processarProximoDaEmpresa(job.empresaId);
  }
}

async function registrarFalhaInesperadaJob(jobId: string, error: any) {
  const jobAtual = await emissaoJobModel.findUnique({ where: { id: jobId } });
  if (!jobAtual) return;

  const payload = parsePayloadSeguro(jobAtual.payloadJson);
  const creditReserved = payload._creditReserved === true;
  const attempts = jobAtual.attempts || 1;
  const maxAttempts = jobAtual.maxAttempts || 5;
  const erroTemporario = isErroTemporarioPortal({ motivo: error?.message, erros: [error?.message, error?.code] }) || !!jobAtual.reservedDpsNumero;
  const erroPayload = {
    error: 'Falha inesperada no processamento da emissao.',
    motivo: error?.message || 'Erro interno no motor de emissao.',
    code: error?.code,
    stack: process.env.NODE_ENV === 'production' ? undefined : error?.stack,
    temporario: erroTemporario,
    userAction: erroTemporario
      ? 'A emissao teve uma falha tecnica ou retorno incerto do Portal. O sistema fara nova tentativa preservando a mesma DPS.'
      : 'A emissao falhou antes da transmissao fiscal. Revise os dados e tente novamente.',
  };

  if (erroTemporario && attempts < maxAttempts) {
    const delayMs = getIntEnv('EMISSION_RETRY_BACKOFF_MS', 5000) * attempts;
    await emissaoJobModel.update({
      where: { id: jobAtual.id },
      data: {
        status: 'ERRO_TEMPORARIO',
        statusMessage: 'Falha tecnica temporaria. Nova tentativa sera feita automaticamente.',
        lastError: JSON.stringify(erroPayload),
        nextAttemptAt: new Date(Date.now() + delayMs),
      },
    });

    await createLog({
      level: 'ERRO',
      action: 'EMISSAO_JOB_EXCEPTION_RETRY',
      message: error?.message || 'Falha inesperada no job de emissao.',
      empresaId: jobAtual.empresaId,
      vendaId: jobAtual.vendaId,
      details: { jobId: jobAtual.id, attempts, maxAttempts, delayMs, reservedDpsNumero: jobAtual.reservedDpsNumero, erro: erroPayload },
    });

    if (jobAtual.vendaId) {
      await notifyFiscalEvent({
        type: 'NOTA_RETRY',
        vendaId: jobAtual.vendaId,
        actorUserId: jobAtual.actorUserId,
        title: 'Nota em nova tentativa',
        message: erroPayload.userAction,
        priority: 'NORMAL',
        eventKeySuffix: `job-${jobAtual.id}-exception-retry-${attempts}`,
        payload: { jobId: jobAtual.id, attempts, nextAttemptAt: new Date(Date.now() + delayMs), erro: erroPayload },
      });
    }

    await agendarNovaTentativa(jobAtual.id, delayMs);
    return;
  }

  if (jobAtual.vendaId) {
    await prisma.venda.update({
      where: { id: jobAtual.vendaId },
      data: { status: 'ERRO_EMISSAO' },
    });
  }

  await emissaoJobModel.update({
    where: { id: jobAtual.id },
    data: {
      status: 'ERRO_FINAL',
      statusMessage: erroPayload.userAction,
      lastError: JSON.stringify(erroPayload),
      finishedAt: new Date(),
    },
  });

  if (creditReserved && !erroTemporario) await releaseEmissionCredit(jobAtual.reservedPlanHistoryId);

  await createLog({
    level: 'ERRO',
    action: 'EMISSAO_JOB_EXCEPTION_FINAL',
    message: error?.message || 'Falha final inesperada no job de emissao.',
    empresaId: jobAtual.empresaId,
    vendaId: jobAtual.vendaId,
    details: { jobId: jobAtual.id, attempts, maxAttempts, reservedDpsNumero: jobAtual.reservedDpsNumero, erro: erroPayload },
  });

  if (jobAtual.vendaId) {
    await notifyFiscalEvent({
      type: 'NOTA_FALHA',
      vendaId: jobAtual.vendaId,
      actorUserId: jobAtual.actorUserId,
      title: 'Nota nao autorizada',
      message: erroPayload.userAction,
      priority: 'HIGH',
      eventKeySuffix: `job-${jobAtual.id}-exception-final`,
      payload: { jobId: jobAtual.id, attempts, erro: erroPayload },
    });
  }
}

async function executarEmissao(job: any) {
  const payload = JSON.parse(job.payloadJson || '{}');
  const creditReserved = payload._creditReserved === true;
  const user = await prisma.user.findUnique({ where: { id: job.actorUserId } });
  const prestador = await prisma.empresa.findUnique({ where: { id: job.empresaId } });
  const tomador = await prisma.cliente.findUnique({ where: { id: job.clienteId } });
  const venda = job.vendaId ? await prisma.venda.findUnique({ where: { id: job.vendaId } }) : null;

  if (!user || !prestador || !tomador || !venda) {
    throw new Error('Job de emissao sem usuario, empresa, tomador ou venda vinculado.');
  }

  const valorFloat = parseFloat(payload.valor);
  const serieFinal = payload.serieDPS || prestador.serieDPS || '900';
  const dpsFinal = job.reservedDpsNumero
    ? Number(job.reservedDpsNumero)
    : payload.numeroDPS
      ? parseInt(payload.numeroDPS)
      : (prestador.ultimoDPS || 0) + 1;

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
      await notifyFiscalEvent({
        type: 'NOTA_RETRY',
        vendaId: venda.id,
        actorUserId: job.actorUserId,
        title: 'Nota em nova tentativa',
        message: 'O Portal Nacional ficou instavel. Vamos tentar novamente preservando a mesma DPS.',
        priority: 'NORMAL',
        eventKeySuffix: `job-${job.id}-retry-${attempts}`,
        payload: { jobId: job.id, attempts, nextAttemptAt: new Date(Date.now() + delayMs), dps: dpsFinal },
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

    await notifyFiscalEvent({
      type: 'NOTA_FALHA',
      vendaId: venda.id,
      actorUserId: job.actorUserId,
      title: erro.temporario ? 'Nota com falha temporaria' : 'Nota nao autorizada',
      message: erro.userAction || erro.motivo || 'A emissao nao foi autorizada. Acesse o historico para revisar.',
      priority: erro.temporario ? 'NORMAL' : 'HIGH',
      eventKeySuffix: `job-${job.id}-final`,
      payload: { jobId: job.id, dps: dpsFinal, erro },
    });

    if (creditReserved && !erro.temporario) await releaseEmissionCredit(job.reservedPlanHistoryId);
    return;
  }

  if (prestador.ambiente === 'HOMOLOGACAO') {
    if (creditReserved) await releaseEmissionCredit(job.reservedPlanHistoryId);

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

  if (!creditReserved && job.reservedPlanHistoryId) await incrementUsage(job.reservedPlanHistoryId);

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

  await notifyFiscalEvent({
    type: 'NOTA_AUTORIZADA',
    vendaId: venda.id,
    notaId: nota.id,
    actorUserId: job.actorUserId,
    title: 'Nota autorizada',
    message: nota.numero && nota.numero > 0 ? `NFS-e ${nota.numero} autorizada com sucesso.` : 'NFS-e autorizada com sucesso.',
    priority: 'NORMAL',
    eventKeySuffix: `job-${job.id}-autorizada`,
    payload: {
      jobId: job.id,
      numero: nota.numero,
      chaveAcesso: nota.chaveAcesso,
      dps: dpsFinal,
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
