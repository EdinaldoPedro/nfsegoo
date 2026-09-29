import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/app/utils/prisma';
import { isAdminRole } from '@/app/utils/access-control';
import { EmissorFactory } from './emissor/factories/EmissorFactory';
import type { IEmissorStrategy, IResultadoEmissao } from './emissor/interfaces/IEmissorStrategy';
import { isConfirmedDpsAbsence } from '@/app/utils/emission-outcome';

const ADMIN_CHECK_LEASE_MS = 2 * 60_000;
const SECOND_ABSENCE_CHECK_DELAY_MS = 2_000;

function safeDiagnostic(result: IResultadoEmissao) {
  const diagnostic = Array.isArray(result.erros)
    ? result.erros.find((item) => item?.portalDiagnostic)?.portalDiagnostic
    : null;
  return diagnostic ? {
    stage: String(diagnostic.stage || '').slice(0, 40),
    category: String(diagnostic.category || '').slice(0, 60),
    httpStatus: Number(diagnostic.httpStatus) || null,
    doubleChecked: diagnostic.doubleChecked === true,
  } : null;
}

async function releaseAdminLease(jobId: string, leaseToken: string, message: string) {
  await prisma.emissaoJob.updateMany({
    where: { id: jobId, status: 'RECONCILIACAO_MANUAL', leaseToken },
    data: { leaseToken: null, leaseUntil: null, lockedBy: null, statusMessage: message },
  });
}

async function scheduleGetOnlyReconciliation(params: {
  actorId: string;
  jobId: string;
  leaseToken: string;
  justification: string;
  result: IResultadoEmissao;
}) {
  await prisma.$transaction(async (tx) => {
    const job = await tx.emissaoJob.findFirst({
      where: { id: params.jobId, status: 'RECONCILIACAO_MANUAL', leaseToken: params.leaseToken },
    });
    if (!job) throw Object.assign(new Error('A emissão mudou durante a verificação. Atualize a tela.'), { status: 409 });
    await tx.emissaoJob.update({ where: { id: job.id }, data: {
      status: 'ERRO_TEMPORARIO', nextAttemptAt: new Date(), leaseToken: null, leaseUntil: null, lockedBy: null,
      maxAttempts: Math.max(job.maxAttempts, job.attempts + 3),
      statusMessage: 'A DPS foi localizada durante a conferência. Somente a conciliação será retomada.',
    } });
    await tx.systemLog.create({ data: {
      level: 'ALERTA', action: 'EMISSION_RETRANSMISSION_ABORTED_DPS_FOUND', module: 'FISCAL',
      message: 'Retransmissão cancelada porque a DPS original foi localizada. Somente consultas serão retomadas.',
      userId: params.actorId, empresaId: job.empresaId, vendaId: job.vendaId,
      details: JSON.stringify({ jobId: job.id, dpsId: job.dpsId, justification: params.justification,
        portalDiagnostic: safeDiagnostic(params.result) }),
    } });
  });
}

export async function requestIdenticalDpsRetransmission(params: {
  actorId: string;
  jobId: string;
  justification: string;
  expectedConfirmation: string;
  strategyOverride?: IEmissorStrategy;
  delay?: (milliseconds: number) => Promise<void>;
}) {
  const leaseToken = `admin-retransmission:${randomUUID()}`;
  const now = new Date();
  const initial = await prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: params.actorId }, select: { role: true } });
    if (!actor || !isAdminRole(actor.role)) throw Object.assign(new Error('Permissão administrativa revogada.'), { status: 403 });
    const job = await tx.emissaoJob.findUnique({ where: { id: params.jobId } });
    if (!job || job.status !== 'RECONCILIACAO_MANUAL' || !job.transmissionStartedAt || !job.signedXml || !job.dpsId || !job.reservedDpsNumero) {
      throw Object.assign(new Error('A emissão não está apta à recuperação segura da mesma DPS.'), { status: 409 });
    }
    if (params.expectedConfirmation !== `RETRANSMITIR DPS ${job.reservedDpsNumero}`) {
      throw Object.assign(new Error(`Digite RETRANSMITIR DPS ${job.reservedDpsNumero} para confirmar.`), { status: 400 });
    }
    if (job.resultNotaId || (job.vendaId && await tx.notaFiscal.count({ where: { vendaId: job.vendaId } }))) {
      throw Object.assign(new Error('Já existe resultado fiscal vinculado à venda. Nenhum reenvio foi autorizado.'), { status: 409 });
    }
    const changed = await tx.emissaoJob.updateMany({
      where: { id: job.id, status: 'RECONCILIACAO_MANUAL', OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      data: { leaseToken, leaseUntil: new Date(now.getTime() + ADMIN_CHECK_LEASE_MS), lockedBy: `admin:${params.actorId}`,
        statusMessage: 'Confirmando novamente a ausência da DPS antes de qualquer retransmissão.' },
    });
    if (!changed.count) throw Object.assign(new Error('Outra verificação administrativa já está em andamento.'), { status: 409 });
    await tx.systemLog.create({ data: {
      level: 'ALERTA', action: 'EMISSION_IDENTICAL_RETRANSMISSION_CHECK_REQUESTED', module: 'FISCAL',
      message: 'Administração iniciou dupla conferência antes de retransmitir a mesma DPS.',
      userId: params.actorId, empresaId: job.empresaId, vendaId: job.vendaId,
      details: JSON.stringify({ jobId: job.id, dpsId: job.dpsId, dpsNumber: job.reservedDpsNumero,
        signedXmlSha256: createHash('sha256').update(job.signedXml).digest('hex'), justification: params.justification }),
    } });
    const company = await tx.empresa.findUniqueOrThrow({ where: { id: job.empresaId } });
    return { job, company };
  });

  const strategy = params.strategyOverride || EmissorFactory.getStrategy({ ...initial.company, ambiente: initial.job.ambiente });
  try {
    const first = await strategy.conciliarDps(initial.job.signedXml!, { ...initial.company, ambiente: initial.job.ambiente });
    if (first.sucesso) {
      await scheduleGetOnlyReconciliation({ ...params, leaseToken, result: first });
      return { retransmissionAuthorized: false, dpsFound: true };
    }
    if (!isConfirmedDpsAbsence(first)) {
      await releaseAdminLease(initial.job.id, leaseToken, 'Ausência da DPS não confirmada. Nenhuma retransmissão foi autorizada.');
      throw Object.assign(new Error('O Portal não confirmou a ausência da DPS. Nenhuma retransmissão foi autorizada.'), { status: 503 });
    }

    await (params.delay || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(SECOND_ABSENCE_CHECK_DELAY_MS);
    const second = await strategy.conciliarDps(initial.job.signedXml!, { ...initial.company, ambiente: initial.job.ambiente });
    if (second.sucesso) {
      await scheduleGetOnlyReconciliation({ ...params, leaseToken, result: second });
      return { retransmissionAuthorized: false, dpsFound: true };
    }
    if (!isConfirmedDpsAbsence(second)) {
      await releaseAdminLease(initial.job.id, leaseToken, 'Ausência da DPS não confirmada na segunda consulta. Nenhuma retransmissão foi autorizada.');
      throw Object.assign(new Error('A segunda consulta não confirmou a ausência da DPS. Nenhuma retransmissão foi autorizada.'), { status: 503 });
    }

    await prisma.$transaction(async (tx) => {
      const current = await tx.emissaoJob.findFirst({
        where: { id: initial.job.id, status: 'RECONCILIACAO_MANUAL', leaseToken },
      });
      if (!current || current.signedXml !== initial.job.signedXml || current.dpsId !== initial.job.dpsId
        || current.reservedDpsNumero !== initial.job.reservedDpsNumero || current.resultNotaId) {
        throw Object.assign(new Error('A emissão mudou durante a conferência. Nenhum reenvio foi autorizado.'), { status: 409 });
      }
      if (current.vendaId && await tx.notaFiscal.count({ where: { vendaId: current.vendaId } })) {
        throw Object.assign(new Error('Uma nota surgiu durante a conferência. Nenhum reenvio foi autorizado.'), { status: 409 });
      }
      await tx.emissaoJob.update({ where: { id: current.id }, data: {
        status: 'ERRO_TEMPORARIO', transmissionStartedAt: null, nextAttemptAt: new Date(), finishedAt: null,
        leaseToken: null, leaseUntil: null, lockedBy: null,
        maxAttempts: Math.max(current.maxAttempts, current.attempts + 3),
        statusMessage: `Ausência confirmada duas vezes. Retransmissão única da DPS ${current.reservedDpsNumero} autorizada.`,
      } });
      await tx.systemLog.create({ data: {
        level: 'ALERTA', action: 'EMISSION_IDENTICAL_RETRANSMISSION_AUTHORIZED', module: 'FISCAL',
        message: 'Ausência confirmada em duas consultas; autorizada retransmissão única do mesmo XML e número de DPS.',
        userId: params.actorId, empresaId: current.empresaId, vendaId: current.vendaId,
        details: JSON.stringify({ jobId: current.id, dpsId: current.dpsId, dpsNumber: current.reservedDpsNumero,
          signedXmlSha256: createHash('sha256').update(current.signedXml!).digest('hex'), absenceChecks: 2,
          justification: params.justification }),
      } });
    });
    return { retransmissionAuthorized: true, dpsFound: false };
  } catch (error) {
    await releaseAdminLease(initial.job.id, leaseToken, 'Recuperação interrompida. Nenhuma retransmissão foi autorizada.').catch(() => undefined);
    throw error;
  }
}
