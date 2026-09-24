import { prisma } from '@/app/utils/prisma';

export const CONSULTATION_HEARTBEAT_MAX_AGE_MS = 45_000;
export const CONSULTATION_QUEUE_DELAY_MS = 5 * 60_000;
const activeStatuses = ['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO'] as const;

export async function consultationWorkerHeartbeat(now = new Date()) {
  return prisma.workerHeartbeat.findFirst({ where: { updatedAt: { gt: new Date(now.getTime() - CONSULTATION_HEARTBEAT_MAX_AGE_MS) },
    OR: [{ id: { startsWith: 'emission-' } }, { id: { startsWith: 'consultation-' } }] },
    orderBy: { updatedAt: 'desc' }, select: { updatedAt: true, id: true } });
}

/** Internal operations view. A stale queue is an alert, not proof of fiscal
 * rejection and not a reason to disable the customer web process. */
export async function consultationQueueHealth(now = new Date()) {
  const deadline = new Date(now.getTime() - CONSULTATION_QUEUE_DELAY_MS);
  const [heartbeat, grouped, waitingTooLong, retryOverdue, processingExpired, oldest] = await Promise.all([
    consultationWorkerHeartbeat(now),
    prisma.fiscalNoteOperation.groupBy({ where: { tipo: 'CONSULTAR' }, by: ['status'], _count: { _all: true } }),
    prisma.fiscalNoteOperation.count({ where: { tipo: 'CONSULTAR', status: 'PENDENTE', createdAt: { lt: deadline } } }),
    prisma.fiscalNoteOperation.count({ where: { tipo: 'CONSULTAR', status: 'ERRO_TEMPORARIO',
      OR: [{ nextAttemptAt: { lt: deadline } }, { nextAttemptAt: null }] } }),
    prisma.fiscalNoteOperation.count({ where: { tipo: 'CONSULTAR', status: 'PROCESSANDO',
      OR: [{ leaseUntil: { lt: deadline } }, { leaseUntil: null }] } }),
    prisma.fiscalNoteOperation.findMany({ where: { tipo: 'CONSULTAR', status: { in: [...activeStatuses, 'RECONCILIACAO_MANUAL'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 25,
      select: { id: true, notaId: true, status: true, attempts: true, maxAttempts: true, statusMessage: true,
        createdAt: true, updatedAt: true, nextAttemptAt: true, leaseUntil: true,
        nota: { select: { vendaId: true, numero: true, numeroOficial: true, empresa: { select: { razaoSocial: true } } } } } }),
  ]);
  const counts = Object.fromEntries(grouped.map(row => [row.status, row._count._all]));
  const active = activeStatuses.reduce((sum, status) => sum + (counts[status] || 0), 0);
  const manual = counts.RECONCILIACAO_MANUAL || 0;
  const workerOnline = Boolean(heartbeat);
  return { workerOnline, lastHeartbeatAt: heartbeat?.updatedAt || null, counts, active,
    waitingTooLong, retryOverdue, processingExpired, manual,
    needsAttention: !workerOnline || waitingTooLong + retryOverdue + processingExpired + manual > 0,
    oldest: oldest.map(row => ({ id: row.id, notaId: row.notaId, status: row.status, attempts: row.attempts,
      maxAttempts: row.maxAttempts, statusMessage: row.statusMessage, createdAt: row.createdAt, updatedAt: row.updatedAt,
      nextAttemptAt: row.nextAttemptAt, leaseUntil: row.leaseUntil,
      vendaId: row.nota.vendaId, numero: row.nota.numeroOficial || (row.nota.numero ? String(row.nota.numero) : '—'), empresa: row.nota.empresa.razaoSocial })) };
}
