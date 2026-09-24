import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { dpsSeriesAliases, normalizeDpsEnvironment, normalizeDpsNumber, normalizeDpsSeries } from '@/app/utils/dps-identity';

type SequenceReader = Pick<Prisma.TransactionClient, 'dpsSequencia' | 'emissaoJob' | 'empresa'>;

export async function readDpsHighWater(db: SequenceReader, empresaId: string, environment: string, series: string) {
  const ambiente = normalizeDpsEnvironment(environment);
  const serie = normalizeDpsSeries(series);
  const aliases = dpsSeriesAliases(serie);
  const [records, jobs, company] = await Promise.all([
    db.dpsSequencia.findMany({ where: { empresaId, ambiente, serie: { in: aliases } }, orderBy: { id: 'asc' } }),
    db.emissaoJob.aggregate({ where: { empresaId, ambiente, serieDPS: { in: aliases } }, _max: { reservedDpsNumero: true } }),
    ambiente === 'PRODUCAO' ? db.empresa.findUnique({ where: { id: empresaId }, select: { ultimoDPS: true } }) : null,
  ]);
  // Rejected/archived jobs still own their reserved number. No reuse.
  // The legacy company counter had no per-series identity. Conservatively
  // retain it as a production floor; never import it into homologation.
  const ultimoConfirmado = Math.max(normalizeDpsNumber(company?.ultimoDPS ?? 0, true),
    ...records.map((row) => normalizeDpsNumber(row.ultimoConfirmado, true)));
  const ultimoReservado = Math.max(normalizeDpsNumber(jobs._max.reservedDpsNumero ?? 0, true),
    ...records.map((row) => normalizeDpsNumber(row.ultimoReservado, true)));
  return { records, empresaId, ambiente, serie, ultimoConfirmado, ultimoReservado };
}

/** Every sequence writer takes this SAME canonical row lock. Historic alias
 * records and already prepared XML remain untouched. Old worker versions must
 * be stopped before rollout: they do not participate in this lock protocol. */
export async function lockCanonicalDpsSequence(tx: Prisma.TransactionClient, params: {
  empresaId: string; ambiente: string; serie: string; fallback?: number; forSync?: boolean;
}) {
  const ambiente = normalizeDpsEnvironment(params.ambiente);
  const serie = normalizeDpsSeries(params.serie);
  const fallback = normalizeDpsNumber(params.fallback ?? 0, true);
  // An ORM upsert with an empty update may use SELECT+INSERT. The first two
  // writers would race; require the database's atomic conflict handling.
  await tx.$executeRaw`
    INSERT INTO "DpsSequencia" ("id", "empresaId", "ambiente", "serie", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${params.empresaId}, ${ambiente}, ${serie}, clock_timestamp(), clock_timestamp())
    ON CONFLICT ("empresaId", "ambiente", "serie") DO NOTHING
  `;
  const [canonical] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "DpsSequencia" WHERE "empresaId" = ${params.empresaId} AND "ambiente" = ${ambiente} AND "serie" = ${serie} FOR UPDATE
  `;
  if (!canonical) throw new Error('Sequência indisponível sob bloqueio.');
  const state = await readDpsHighWater(tx, params.empresaId, ambiente, serie);
  if (params.forSync) {
    const busy = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "DpsSequencia" WHERE "empresaId" = ${params.empresaId} AND "ambiente" = ${ambiente}
        AND "serie" = ANY(${dpsSeriesAliases(serie)}::text[]) AND "syncLockedUntil" > clock_timestamp() LIMIT 1
    `;
    if (busy.length) throw Object.assign(new Error('Já existe uma sincronização em andamento para este ambiente e série.'), { status: 409 });
  }
  return tx.dpsSequencia.update({ where: { id: canonical.id }, data: {
    ultimoConfirmado: Math.max(fallback, state.ultimoConfirmado), ultimoReservado: state.ultimoReservado,
  } });
}

export async function setUserDpsSequenceInTransaction(tx: Prisma.TransactionClient, params: {
  empresaId: string; ambiente: string; serie: string; ultimoConfirmado: number; userId: string;
}) {
  const number = normalizeDpsNumber(params.ultimoConfirmado, true);
  const sequence = await lockCanonicalDpsSequence(tx, params);
  return tx.dpsSequencia.update({ where: { id: sequence.id }, data: {
    ultimoConfirmado: Math.max(sequence.ultimoConfirmado, number), origem: 'CONFIGURACAO_USUARIO',
    statusSincronizacao: 'INFORMADO', atualizadoPor: params.userId,
  } });
}
