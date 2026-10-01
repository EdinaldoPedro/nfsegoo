import { prisma } from '@/app/utils/prisma';
import { isAdminRole } from '@/app/utils/access-control';
import { normalizeDpsNumber, normalizeDpsSeries } from '@/app/utils/dps-identity';
import { releaseEmissionCredit } from './planService';
import { lockCanonicalDpsSequence } from './dpsSequenceStore';

function parseJson(value: unknown) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

export function hasE0014Evidence(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  const parsed = parseJson(value);
  if (parsed !== value) return hasE0014Evidence(parsed, depth + 1);
  if (Array.isArray(value)) return value.some((item) => hasE0014Evidence(item, depth + 1));
  if (typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const code = String(record.codigo ?? record.Codigo ?? record.code ?? record.Code ?? '').toUpperCase();
  if (code === 'E0014') return true;
  return Object.values(record).some((item) => hasE0014Evidence(item, depth + 1));
}

export async function resolveDpsIdentityConflict(params: { actorId: string; jobId: string; justification: string }) {
  return prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: params.actorId }, select: { role: true } });
    if (!actor || !isAdminRole(actor.role)) throw Object.assign(new Error('Permissão administrativa revogada.'), { status: 403 });

    const existing = await tx.emissaoJob.findUnique({ where: { id: params.jobId }, select: { empresaId: true } });
    if (!existing) throw Object.assign(new Error('Emissão não encontrada.'), { status: 404 });
    await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${existing.empresaId} FOR UPDATE`;
    const rows = await tx.$queryRaw<Array<any>>`SELECT * FROM "EmissaoJob" WHERE "id" = ${params.jobId} FOR UPDATE`;
    const job = rows[0];
    if (!job || job.status !== 'RECONCILIACAO_MANUAL' || !job.transmissionStartedAt || !job.signedXml || !job.vendaId) {
      throw Object.assign(new Error('Esta emissão não está elegível para encerramento de conflito.'), { status: 409 });
    }
    if (!job.reservedDpsNumero || !job.serieDPS) throw Object.assign(new Error('Identidade da DPS original está incompleta.'), { status: 409 });
    if (job.resultNotaId || await tx.notaFiscal.count({ where: { vendaId: job.vendaId, status: { in: ['AUTORIZADA', 'CANCELADA'] } } })) {
      throw Object.assign(new Error('Já existe nota autorizada para esta venda. O conflito não pode ser encerrado como falha.'), { status: 409 });
    }

    const evidenceLogs = await tx.systemLog.findMany({
      where: { empresaId: job.empresaId, vendaId: job.vendaId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, action: true, details: true },
    });
    const evidence = hasE0014Evidence(job.lastError)
      ? { source: 'JOB_LAST_ERROR' }
      : evidenceLogs.find((entry) => hasE0014Evidence(entry.details));
    if (!evidence) throw Object.assign(new Error('Não há evidência estruturada do erro E0014 para esta emissão.'), { status: 409 });

    const numero = normalizeDpsNumber(job.reservedDpsNumero);
    const serie = normalizeDpsSeries(job.serieDPS);
    const sequence = await lockCanonicalDpsSequence(tx, { empresaId: job.empresaId, ambiente: job.ambiente, serie });
    await tx.dpsSequencia.update({ where: { id: sequence.id }, data: {
      ultimoConfirmado: Math.max(sequence.ultimoConfirmado, numero),
      origem: 'CONFLITO_E0014_RESOLVIDO',
      statusSincronizacao: 'CONFIRMADO',
      sincronizadoEm: new Date(),
      atualizadoPor: params.actorId,
    } });
    if (job.ambiente === 'PRODUCAO') {
      await tx.$executeRaw`UPDATE "Empresa" SET "ultimoDPS" = GREATEST(COALESCE("ultimoDPS", 0), ${numero}) WHERE "id" = ${job.empresaId}`;
    }
    await releaseEmissionCredit(job.creditReservationId, tx);

    const previousError = parseJson(job.lastError);
    await tx.emissaoJob.update({ where: { id: job.id }, data: {
      status: 'ERRO_FINAL',
      statusMessage: `Conflito de numeração confirmado na DPS ${numero}. A venda está liberada para uma nova emissão automática.`,
      finishedAt: new Date(),
      nextAttemptAt: null,
      leaseToken: null,
      leaseUntil: null,
      lastError: JSON.stringify({
        userAction: 'Corrija os dados, se necessário, e emita novamente. A nova tentativa usará a numeração automática.',
        motivo: 'DPS_IDENTITY_CONFLICT',
        code: 'DPS_IDENTITY_CONFLICT',
        portalCode: 'E0014',
        draftEligible: true,
        draftReasonType: 'DPS_IDENTITY_CONFLICT',
        resolution: { actorId: params.actorId, justification: params.justification, resolvedAt: new Date().toISOString(), evidence },
        previousError,
      }),
    } });
    await tx.venda.update({ where: { id: job.vendaId }, data: { status: 'ERRO_EMISSAO' } });
    await tx.systemLog.create({ data: {
      level: 'ALERTA',
      action: 'EMISSION_DPS_IDENTITY_CONFLICT_RESOLVED',
      module: 'FISCAL',
      message: `Conflito E0014 encerrado na DPS ${numero}; venda liberada para nova emissão.`,
      userId: params.actorId,
      empresaId: job.empresaId,
      vendaId: job.vendaId,
      details: JSON.stringify({ jobId: job.id, ambiente: job.ambiente, serie, numero, justification: params.justification, evidence }),
    } });
    return { vendaId: job.vendaId, jobId: job.id, numero };
  });
}
