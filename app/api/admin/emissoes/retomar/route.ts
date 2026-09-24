import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isAdminRole, isSupportRole } from '@/app/utils/access-control';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { prisma } from '@/app/utils/prisma';
import { resumeFiscalNoteReconciliation } from '@/app/services/fiscalNoteService';
import { consultationQueueHealth } from '@/app/services/consultationQueueHealth';
import { documentQueueHealth } from '@/app/services/documentQueueHealth';
import { emissionQueueHealth } from '@/app/services/emissionQueueHealth';

export const dynamic = 'force-dynamic';

export const GET = withApiGuard(async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();
  const [emissionHealth, documents, noteOperations, consultations, documentHealth] = await Promise.all([
    emissionQueueHealth(),
    prisma.emissionDocumentTask.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.fiscalNoteOperation.groupBy({ by: ['tipo', 'status'], _count: { _all: true } }),
    consultationQueueHealth(),
    documentQueueHealth(),
  ]);
  return NextResponse.json({ workerOnline: emissionHealth.workerOnline,
    productionWorkerOnline: emissionHealth.productionWorkerOnline,
    lastHeartbeatAt: emissionHealth.lastHeartbeatAt, counts: Object.entries(emissionHealth.counts).map(([status, count]) => ({ status, _count: { _all: count } })),
    emissionHealth, documents, noteOperations, consultations, documentHealth });
});

// No HTTP-triggered fiscal processing and no shared cron secret.
// Administrative recovery only requeues GET reconciliation of an existing DPS.
export const POST = withApiGuard(async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role)) return forbidden();
  const body = await request.json();
  if ((typeof body.jobId !== 'string') === (typeof body.operationId !== 'string')) return NextResponse.json({ error: 'Informe uma única emissão ou operação de nota a conciliar.' }, { status: 400 });
  const reauth = await requireAdminReauthentication({ actorId: user.id, password: body.adminPassword, justification: body.justification, action: 'EMISSION_RECONCILE' });
  if (reauth) return reauth;
  if (typeof body.operationId === 'string') {
    try {
      await resumeFiscalNoteReconciliation(user.id, body.operationId, body.justification);
      return NextResponse.json({ accepted: true, message: 'Nova conciliação registrada. Nenhum pedido fiscal será reenviado.' }, { status: 202 });
    } catch (error) {
      const failure = error as Error & { status?: number };
      if (failure.status && failure.status < 500) return NextResponse.json({ error: failure.message }, { status: failure.status });
      throw error;
    }
  }
  const result = await prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: user.id }, select: { role: true } });
    if (!actor || !isAdminRole(actor.role)) throw Object.assign(new Error('Permissão revogada.'), { status: 403 });
    const job = await tx.emissaoJob.findUnique({ where: { id: body.jobId } });
    if (!job || job.status !== 'RECONCILIACAO_MANUAL' || !job.transmissionStartedAt || !job.signedXml) return false;
    const changed = await tx.emissaoJob.updateMany({ where: { id: job.id, status: 'RECONCILIACAO_MANUAL' },
      data: { status: 'ERRO_TEMPORARIO', nextAttemptAt: new Date(), maxAttempts: job.attempts + 5, statusMessage: 'Nova consulta da DPS original solicitada pela administração.' } });
    if (!changed.count) return false;
    await tx.systemLog.create({ data: { level: 'ALERTA', action: 'EMISSION_RECONCILE_REQUESTED',
      message: 'Conciliação GET-only solicitada; sem reenvio, alteração de XML ou devolução de crédito.',
      userId: user.id, empresaId: job.empresaId, vendaId: job.vendaId,
      details: JSON.stringify({ jobId: job.id, justification: String(body.justification).trim() }) } });
    return true;
  });
  return result ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Emissão não elegível para nova consulta. Nenhum envio realizado.' }, { status: 409 });
}, { maxBodyBytes: 16 * 1024 });
