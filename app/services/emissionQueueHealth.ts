import { prisma } from '@/app/utils/prisma';

export const EMISSION_HEARTBEAT_MAX_AGE_MS = 45_000;
export const EMISSION_QUEUE_DELAY_MS = 5 * 60_000;

export function emissionHealthSummary(input: {
  workerOnline: boolean;
  productionWorkerOnline: boolean;
  active: number;
  productionActive: number;
  waitingTooLong: number;
  retryOverdue: number;
  processingExpired: number;
  manual: number;
}) {
  return {
    ...input,
    needsAttention: (input.active > 0 && !input.workerOnline)
      || (input.productionActive > 0 && !input.productionWorkerOnline)
      || input.waitingTooLong + input.retryOverdue + input.processingExpired + input.manual > 0,
  };
}

/** Emission health must never be inferred from document/consultation heartbeats. */
export async function emissionQueueHealth(now = new Date()) {
  const heartbeatDeadline = new Date(now.getTime() - EMISSION_HEARTBEAT_MAX_AGE_MS);
  const queueDeadline = new Date(now.getTime() - EMISSION_QUEUE_DELAY_MS);
  const [heartbeat, productionHeartbeat, grouped, productionActive, waitingTooLong, retryOverdue, processingExpired, manual] = await Promise.all([
    prisma.workerHeartbeat.findFirst({ where: { id: { startsWith: 'emission-' }, updatedAt: { gt: heartbeatDeadline } },
      orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.workerHeartbeat.findFirst({ where: { id: { startsWith: 'emission-' }, productionEnabled: true, updatedAt: { gt: heartbeatDeadline } },
      orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.emissaoJob.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.emissaoJob.count({ where: { ambiente: 'PRODUCAO', status: { in: ['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO'] } } }),
    prisma.emissaoJob.count({ where: { status: 'PENDENTE', createdAt: { lt: queueDeadline },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] } }),
    prisma.emissaoJob.count({ where: { status: 'ERRO_TEMPORARIO',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lt: queueDeadline } }] } }),
    prisma.emissaoJob.count({ where: { status: 'PROCESSANDO',
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: queueDeadline } }] } }),
    prisma.emissaoJob.count({ where: { status: 'RECONCILIACAO_MANUAL' } }),
  ]);
  const counts = Object.fromEntries(grouped.map(row => [row.status, row._count._all]));
  const active = (counts.PENDENTE || 0) + (counts.PROCESSANDO || 0) + (counts.ERRO_TEMPORARIO || 0);
  return { ...emissionHealthSummary({ workerOnline: Boolean(heartbeat), productionWorkerOnline: Boolean(productionHeartbeat),
    active, productionActive, waitingTooLong, retryOverdue, processingExpired, manual }),
    lastHeartbeatAt: heartbeat?.updatedAt || null, lastProductionHeartbeatAt: productionHeartbeat?.updatedAt || null, counts };
}
