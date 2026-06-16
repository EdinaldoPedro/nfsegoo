import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { validateRequest } from '@/app/utils/api-security';
import { unauthorized, forbidden } from '@/app/utils/api-middleware';
import { dispararProcessamentoEmissaoJob, retomarEmissoesPendentes } from '@/app/services/emissaoJobService';
import { hasEmpresaAccess } from '@/app/utils/access-control';

const prisma = new PrismaClient();
const emissaoJobModel = (prisma as any).emissaoJob;

function parseLastError(lastError?: string | null) {
  if (!lastError) return null;
  try {
    return JSON.parse(lastError);
  } catch {
    return { userAction: lastError };
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  const user = await prisma.user.findUnique({ where: { id: targetId } });
  if (!user) return unauthorized();

  const job = await emissaoJobModel.findUnique({ where: { id: params.id } });
  if (!job) {
    return NextResponse.json({ error: 'Job de emissao nao encontrado.' }, { status: 404 });
  }

  const allowed = await hasEmpresaAccess(user, job.empresaId);
  if (!allowed) return forbidden();

  const erro = parseLastError(job.lastError);
  const retryDue = !job.nextAttemptAt || new Date(job.nextAttemptAt) <= new Date();
  const staleMinutes = Number(process.env.EMISSION_STALE_PROCESSING_MINUTES || 15);
  const staleProcessing =
    job.status === 'PROCESSANDO' &&
    (!job.lockedAt || new Date(job.lockedAt).getTime() < Date.now() - staleMinutes * 60 * 1000);

  if (['PENDENTE', 'ERRO_TEMPORARIO'].includes(job.status) && retryDue) {
    dispararProcessamentoEmissaoJob(job.id);
  } else if (staleProcessing) {
    retomarEmissoesPendentes({ limit: 10, recuperarTravados: true }).catch(console.error);
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    statusMessage: job.statusMessage,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    empresaId: job.empresaId,
    vendaId: job.vendaId,
    notaId: job.resultNotaId,
    isHomologation: job.status === 'AUTORIZADA' && !job.resultNotaId,
    nextAttemptAt: job.nextAttemptAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    userAction: erro?.userAction || null,
    draftEligible: erro?.draftEligible || false,
    draftReasonType: erro?.draftReasonType || null,
    details: erro?.details || null,
    error: erro?.motivo || erro?.error || null,
  });
}
