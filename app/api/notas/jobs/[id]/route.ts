import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { validateRequest } from '@/app/utils/api-security';
import { unauthorized, forbidden } from '@/app/utils/api-middleware';
import { dispararProcessamentoEmissaoJob } from '@/app/services/emissaoJobService';

const prisma = new PrismaClient();
const emissaoJobModel = (prisma as any).emissaoJob;

async function podeAcessarEmpresa(user: any, empresaId: string) {
  const isStaff = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(user.role);
  if (isStaff || user.empresaId === empresaId) return true;

  const colaborador = await prisma.userCliente.findUnique({
    where: { userId_empresaId: { userId: user.id, empresaId } },
  });
  if (colaborador) return true;

  const vinculo = await prisma.contadorVinculo.findUnique({
    where: { contadorId_empresaId: { contadorId: user.id, empresaId } },
  });

  return Boolean(vinculo && vinculo.status === 'APROVADO' && !(vinculo as any).arquivadoEm);
}

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

  const allowed = await podeAcessarEmpresa(user, job.empresaId);
  if (!allowed) return forbidden();

  const erro = parseLastError(job.lastError);
  const retryDue = !job.nextAttemptAt || new Date(job.nextAttemptAt) <= new Date();

  if (['PENDENTE', 'ERRO_TEMPORARIO'].includes(job.status) && retryDue) {
    dispararProcessamentoEmissaoJob(job.id);
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
