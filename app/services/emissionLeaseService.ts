import { randomUUID } from 'node:crypto';
import type { EmissaoJob, Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { nextDpsCandidate, normalizeDpsNumber, normalizeDpsSeries } from '@/app/utils/dps-identity';
import { lockCanonicalDpsSequence } from './dpsSequenceStore';
import { headDps } from './dpsSequenceService';

export type LeasedEmission = EmissaoJob & { leaseToken: string };
export class LostEmissionLease extends Error { constructor() { super('Posse da tarefa expirada.'); } }

/** Atomic claim; an unresolved head blocks its company, never unrelated tenants.
 * A partial UNIQUE index is a second defense against two PROCESSANDO jobs. */
export async function claimEmission(workerId: string, companyIds?: string[], allowProduction = false): Promise<LeasedEmission | null> {
  const token = randomUUID();
  const rows = await prisma.$queryRaw<LeasedEmission[]>`
    WITH candidate AS (
      SELECT j."id" FROM "EmissaoJob" j
      WHERE j."status" IN ('PENDENTE', 'ERRO_TEMPORARIO', 'PROCESSANDO')
        AND (${allowProduction} OR j."ambiente" = 'HOMOLOGACAO' OR j."transmissionStartedAt" IS NOT NULL)
        AND (j."nextAttemptAt" IS NULL OR j."nextAttemptAt" <= clock_timestamp())
        AND (j."leaseUntil" IS NULL OR j."leaseUntil" <= clock_timestamp())
        AND (${companyIds === undefined} OR j."empresaId" = ANY(${companyIds || []}::text[]))
        AND NOT EXISTS (SELECT 1 FROM "EmissaoJob" busy WHERE busy."empresaId" = j."empresaId"
          AND busy."id" <> j."id" AND (busy."status" IN ('PROCESSANDO', 'RECONCILIACAO_MANUAL')
            OR (busy."status" = 'ERRO_TEMPORARIO' AND busy."transmissionStartedAt" IS NOT NULL)))
        AND (j."status" = 'PROCESSANDO' OR j."transmissionStartedAt" IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM "EmissaoJob" older WHERE older."empresaId" = j."empresaId"
            AND older."status" IN ('PENDENTE', 'ERRO_TEMPORARIO', 'PROCESSANDO', 'RECONCILIACAO_MANUAL')
            AND (older."createdAt", older."id") < (j."createdAt", j."id")
        ))
      ORDER BY j."createdAt", j."id" FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "EmissaoJob" j SET "status" = 'PROCESSANDO', "leaseToken" = ${token},
      "leaseUntil" = clock_timestamp() + interval '120 seconds', "lockedAt" = clock_timestamp(),
      "lockedBy" = ${workerId}, "attempts" = "attempts" + 1, "nextAttemptAt" = NULL,
      "startedAt" = COALESCE("startedAt", clock_timestamp()), "updatedAt" = clock_timestamp()
    FROM candidate WHERE j."id" = candidate."id" RETURNING j.*
  `;
  return rows[0] || null;
}

export async function withEmissionLease<T>(job: Pick<LeasedEmission, 'id' | 'leaseToken'>, action: (tx: Prisma.TransactionClient, current: EmissaoJob) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<EmissaoJob[]>`
      SELECT * FROM "EmissaoJob" WHERE "id" = ${job.id} AND "leaseToken" = ${job.leaseToken}
        AND "status" = 'PROCESSANDO' AND "leaseUntil" > clock_timestamp() FOR UPDATE
    `;
    if (!rows[0]) throw new LostEmissionLease();
    return action(tx, rows[0]);
  });
}

export async function renewEmissionLease(job: Pick<LeasedEmission, 'id' | 'leaseToken'>) {
  const changed = await prisma.$executeRaw`
    UPDATE "EmissaoJob" SET "leaseUntil" = clock_timestamp() + interval '120 seconds'
    WHERE "id" = ${job.id} AND "leaseToken" = ${job.leaseToken} AND "status" = 'PROCESSANDO'
      AND "leaseUntil" > clock_timestamp()
  `;
  return changed === 1;
}

/** Reserve monotonically inside the same short transaction as the job field.
 * Rejected numbers are deliberately not reused. No network under a DB lock. */
export async function reserveJobDps(job: LeasedEmission) {
  return withEmissionLease(job, async (tx, current) => {
    if (current.reservedDpsNumero) return current;
    const company = await tx.empresa.findUniqueOrThrow({ where: { id: current.empresaId } });
    const payload = JSON.parse(current.payloadJson);
    const serie = normalizeDpsSeries(current.serieDPS || company.serieDPS || '900');
    const sequence = await lockCanonicalDpsSequence(tx, { empresaId: company.id, ambiente: current.ambiente, serie,
      fallback: current.ambiente === 'PRODUCAO' ? company.ultimoDPS || 0 : 0 });
    const floor = Math.max(sequence.ultimoConfirmado, sequence.ultimoReservado);
    const manualNumber = payload.numeroDPS !== undefined && payload.numeroDPS !== null && payload.numeroDPS !== '';
    const numero = manualNumber ? normalizeDpsNumber(payload.numeroDPS) : nextDpsCandidate(sequence.ultimoConfirmado, sequence.ultimoReservado);
    if (numero === null || numero <= floor) {
      throw Object.assign(new Error('Número de DPS já reservado/confirmado ou inválido. Utilize a próxima sequência disponível.'), { status: 400 });
    }
    await tx.dpsSequencia.update({ where: { id: sequence.id }, data: { ultimoReservado: numero } });
    return tx.emissaoJob.update({ where: { id: current.id }, data: { reservedDpsNumero: numero, serieDPS: serie } });
  });
}

export const MAX_AUTOMATIC_DPS_SKIPS = 20;

type HeadDps = typeof headDps;

/** Checks the reserved identity before freezing/signing the XML. Numbers already
 * present in the Portal are advanced atomically, without holding a DB lock while
 * the network request is running. A POST race is still handled by reconciliation. */
export async function preflightReservedDps(
  job: LeasedEmission,
  options: { maxSkips?: number; inspectDps?: HeadDps } = {},
) {
  const maxSkips = options.maxSkips ?? MAX_AUTOMATIC_DPS_SKIPS;
  const inspectDps = options.inspectDps ?? headDps;
  const skipped: number[] = [];

  for (;;) {
    const snapshot = await withEmissionLease(job, async (tx, current) => {
      if (current.transmissionStartedAt || current.signedXml) return { current, company: null, manualNumber: false };
      if (!current.reservedDpsNumero || !current.serieDPS) throw new Error('DPS ainda não reservada para conferência.');
      const company = await tx.empresa.findUniqueOrThrow({ where: { id: current.empresaId } });
      const payload = JSON.parse(current.payloadJson);
      const manualNumber = payload.numeroDPS !== undefined && payload.numeroDPS !== null && payload.numeroDPS !== '';
      return { current, company, manualNumber };
    });
    if (!snapshot.company || snapshot.current.transmissionStartedAt || snapshot.current.signedXml) {
      return { job: snapshot.current, skipped };
    }

    const checkedNumber = normalizeDpsNumber(snapshot.current.reservedDpsNumero);
    const lookup = await inspectDps(snapshot.company, snapshot.current.ambiente as 'HOMOLOGACAO' | 'PRODUCAO', snapshot.current.serieDPS!, checkedNumber);
    if (!lookup.exists) return { job: snapshot.current, skipped };
    if (snapshot.manualNumber) {
      throw Object.assign(new Error(`A DPS ${checkedNumber} já existe no Portal Nacional. Informe outro número ou use a numeração automática.`), { status: 400 });
    }
    if (skipped.length >= maxSkips) {
      throw Object.assign(new Error(`Foram encontrados mais de ${maxSkips} números de DPS já utilizados. Sincronize a numeração da empresa antes de emitir.`), { status: 400 });
    }

    const advanced = await withEmissionLease(job, async (tx, current) => {
      if (current.transmissionStartedAt || current.signedXml) return current;
      if (current.reservedDpsNumero !== checkedNumber) return current;
      const serie = normalizeDpsSeries(current.serieDPS || snapshot.current.serieDPS || '900');
      const sequence = await lockCanonicalDpsSequence(tx, {
        empresaId: current.empresaId,
        ambiente: current.ambiente,
        serie,
      });
      const next = nextDpsCandidate(Math.max(sequence.ultimoConfirmado, checkedNumber), sequence.ultimoReservado);
      if (next === null) {
        throw Object.assign(new Error('A numeração de DPS atingiu o limite suportado. Solicite análise; não reinicie a sequência.'), { status: 400 });
      }
      await tx.dpsSequencia.update({ where: { id: sequence.id }, data: {
        ultimoConfirmado: Math.max(sequence.ultimoConfirmado, checkedNumber),
        ultimoReservado: next,
        origem: 'PORTAL_HEAD_AUTOMATICO',
        statusSincronizacao: 'CONFIRMADO',
        sincronizadoEm: new Date(),
      } });
      await tx.systemLog.create({ data: {
        level: 'INFO',
        action: 'DPS_NUMERACAO_AJUSTADA_AUTOMATICAMENTE',
        message: `DPS ${checkedNumber} já utilizada; emissão avançada automaticamente para ${next}.`,
        empresaId: current.empresaId,
        vendaId: current.vendaId,
        userId: current.actorUserId,
        details: JSON.stringify({ jobId: current.id, serie, ambiente: current.ambiente, de: checkedNumber, para: next }),
      } });
      return tx.emissaoJob.update({ where: { id: current.id }, data: {
        reservedDpsNumero: next,
        serieDPS: serie,
        statusMessage: `A DPS ${checkedNumber} já estava utilizada. Conferindo automaticamente a DPS ${next}.`,
      } });
    });
    skipped.push(checkedNumber);
    if (advanced.transmissionStartedAt || advanced.signedXml) return { job: advanced, skipped };
  }
}
