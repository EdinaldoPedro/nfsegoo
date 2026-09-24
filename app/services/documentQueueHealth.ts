import { prisma } from '@/app/utils/prisma';

export const DOCUMENT_HEARTBEAT_MAX_AGE_MS = 45_000;
export const DOCUMENT_QUEUE_DELAY_MS = 5 * 60_000;

/** A document worker or the full emission worker can process DANFSe tasks. */
export async function documentQueueHealth(now = new Date()) {
  const deadline = new Date(now.getTime() - DOCUMENT_QUEUE_DELAY_MS);
  const [heartbeat, grouped, waitingTooLong, retryOverdue, processingExpired] = await Promise.all([
    prisma.workerHeartbeat.findFirst({ where: { updatedAt: { gt: new Date(now.getTime() - DOCUMENT_HEARTBEAT_MAX_AGE_MS) },
      OR: [{ id: { startsWith: 'document-' } }, { id: { startsWith: 'emission-' } }] },
    orderBy: { updatedAt: 'desc' }, select: { id: true, updatedAt: true } }),
    prisma.emissionDocumentTask.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.emissionDocumentTask.count({ where: { status: 'PENDENTE', createdAt: { lt: deadline },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] } }),
    prisma.emissionDocumentTask.count({ where: { status: 'PENDENTE', nextAttemptAt: { lt: deadline } } }),
    prisma.emissionDocumentTask.count({ where: { status: 'PROCESSANDO', OR: [{ leaseUntil: null }, { leaseUntil: { lt: deadline } }] } }),
  ]);
  const counts = Object.fromEntries(grouped.map(row => [row.status, row._count._all]));
  const active = (counts.PENDENTE || 0) + (counts.PROCESSANDO || 0);
  const manual = counts.REVISAO_MANUAL || 0;
  return { workerOnline: Boolean(heartbeat), lastHeartbeatAt: heartbeat?.updatedAt || null, counts, active,
    waitingTooLong, retryOverdue, processingExpired, manual,
    needsAttention: (active > 0 && !heartbeat) || waitingTooLong + retryOverdue + processingExpired + manual > 0 };
}
