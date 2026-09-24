import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { validateRequest } from '@/app/utils/api-security';
import { unauthorized, forbidden } from '@/app/utils/api-middleware';
import { hasCustomerCompanyAccess } from '@/app/utils/access-control';

function parseLastError(lastError?: string | null) {
  if (!lastError) return null;
  try {
    return JSON.parse(lastError);
  } catch {
    return { userAction: lastError };
  }
}

export const GET = withApiGuard(async function GET(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  const user = await prisma.user.findUnique({ where: { id: targetId } });
  if (!user) return unauthorized();

  const job = await prisma.emissaoJob.findUnique({ where: { id: params.id }, select: {
    id: true, empresaId: true, vendaId: true, status: true, statusMessage: true, attempts: true, maxAttempts: true,
    resultNotaId: true, ambiente: true, nextAttemptAt: true, startedAt: true, finishedAt: true, lastError: true,
    createdAt: true,
  } });
  if (!job) {
    return NextResponse.json({ error: 'Job de emissao nao encontrado.' }, { status: 404 });
  }

  const allowed = await hasCustomerCompanyAccess(user, job.empresaId);
  if (!allowed) return forbidden();

  const erro = parseLastError(job.lastError);
  const active = ['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO'].includes(job.status);
  const processorOffline = active && Date.now() - job.createdAt.getTime() > 60_000
    && !await prisma.workerHeartbeat.findFirst({ where: { id: { startsWith: 'emission-' },
      updatedAt: { gt: new Date(Date.now() - 45_000) } }, select: { id: true } });
  return NextResponse.json({
    id: job.id,
    status: job.status,
    statusMessage: job.statusMessage,
    processorOffline: Boolean(processorOffline),
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    empresaId: job.empresaId,
    vendaId: job.vendaId,
    notaId: job.resultNotaId,
    isHomologation: job.status === 'AUTORIZADA' && job.ambiente === 'HOMOLOGACAO',
    requiresReconciliation: job.status === 'RECONCILIACAO_MANUAL',
    nextAttemptAt: job.nextAttemptAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    userAction: erro?.userAction || null,
    draftEligible: erro?.draftEligible || false,
    draftReasonType: erro?.draftReasonType || null,
    details: erro?.details || null,
    error: erro?.motivo || erro?.error || null,
  });
});
