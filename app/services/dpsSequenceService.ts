import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import { prisma } from '@/app/utils/prisma';
import { openEmpresaCertificate } from '@/app/services/certificateVault';
import { createLog } from '@/app/services/logger';
import { MAX_STORED_DPS_NUMBER, nextDpsCandidate, normalizeDpsEnvironment, normalizeDpsNumber, normalizeDpsSeries } from '@/app/utils/dps-identity';
import type { DpsAmbiente } from '@/app/utils/dps-identity';
import { fiscalCnpj } from '@/app/utils/fiscal-identifiers';
import { lockCanonicalDpsSequence, readDpsHighWater, setUserDpsSequenceInTransaction } from './dpsSequenceStore';
export { normalizeDpsEnvironment, normalizeDpsSeries } from '@/app/utils/dps-identity';
export type { DpsAmbiente } from '@/app/utils/dps-identity';

export interface DpsSequenceRecord {
  id: string;
  empresaId: string;
  ambiente: string;
  serie: string;
  ultimoConfirmado: number;
  ultimoReservado: number;
  sincronizadoEm: Date | null;
  origem: string;
  statusSincronizacao: string;
  atualizadoPor: string | null;
  syncToken: string | null;
  syncLockedUntil: Date | null;
}

const BASE_URLS: Record<DpsAmbiente, string> = {
  HOMOLOGACAO: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
  PRODUCAO: 'https://sefin.nfse.gov.br/SefinNacional',
};

function digits(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

export function buildDpsId(empresa: any, series: string, number: number) {
  const serie = normalizeDpsSeries(series);
  const numero = normalizeDpsNumber(number);
  const municipio = digits(empresa.codigoIbge);
  const documento = fiscalCnpj(empresa.documento);
  if (municipio.length !== 7) throw Object.assign(new Error('Código IBGE do município emissor inválido.'), { status: 400 });
  if (!documento) throw Object.assign(new Error('CNPJ do prestador inválido.'), { status: 400 });

  return `DPS${municipio}2${documento}${serie.padStart(5, '0')}${String(numero).padStart(15, '0')}`;
}

function isTransientStatus(status?: number) {
  return status === 408 || status === 425 || status === 429 || Boolean(status && status >= 500);
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function headDps(empresa: any, environment: DpsAmbiente, serie: string, numero: number) {
  const ambiente = normalizeDpsEnvironment(environment);
  const idDps = buildDpsId(empresa, serie, numero);
  const credentials = openEmpresaCertificate({
    empresaId: empresa.id,
    certificadoA1: empresa.certificadoA1,
    senhaCertificado: empresa.senhaCertificado,
    expectedCnpj: empresa.documento,
    requireTrustedChain: ambiente === 'PRODUCAO',
    purpose: 'CONSULT_DPS',
  });
  const url = `${BASE_URLS[ambiente]}/dps/${idDps}`;
  const httpsAgent = new https.Agent({
    cert: credentials.cert,
    key: credentials.key,
    rejectUnauthorized: true,
    keepAlive: true,
    family: 4,
  });
  try {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await axios.head(url, {
        httpsAgent,
        timeout: 12000,
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) return { exists: true, idDps, status: response.status };
      if (response.status === 404) return { exists: false, idDps, status: response.status };
      if (!isTransientStatus(response.status)) {
        throw Object.assign(new Error(`O Portal recusou a consulta da DPS (HTTP ${response.status}).`), { portalStatus: response.status });
      }
      if (attempt === 3) throw new Error(`Portal indisponível para consulta da DPS (HTTP ${response.status}).`);
    } catch (error: any) {
      if (error?.portalStatus) throw error;
      // Never propagate an Axios config containing the certificate/private key.
      // eslint-disable-next-line preserve-caught-error -- Axios cause contains private TLS credentials; intentionally discarded.
      if (attempt === 3) throw new Error('Não foi possível consultar a DPS no Portal Nacional.');
    }
    await wait(400 * attempt);
  }

  throw new Error('Não foi possível consultar a DPS no Portal Nacional.');
  } finally { httpsAgent.destroy(); }
}

export async function findDpsSequence(empresaId: string, ambiente: DpsAmbiente, serie: string) {
  const state = await readDpsHighWater(prisma, empresaId, ambiente, serie);
  const record = state.records.find((row) => row.serie === state.serie) || state.records[0];
  if (!record && !state.ultimoReservado && !state.ultimoConfirmado) return null;
  return { id: record?.id ?? null, empresaId, ambiente: state.ambiente, serie: state.serie,
    ultimoConfirmado: state.ultimoConfirmado, ultimoReservado: state.ultimoReservado,
    sincronizadoEm: record?.sincronizadoEm ?? null, origem: record?.origem ?? 'RESERVA_HISTORICA',
    statusSincronizacao: record?.statusSincronizacao ?? 'NAO_SINCRONIZADO', atualizadoPor: record?.atualizadoPor ?? null };
}

export async function listDpsSequences(empresaId: string) {
  const [records, jobs, company] = await Promise.all([
    prisma.dpsSequencia.findMany({ where: { empresaId }, orderBy: [{ ambiente: 'asc' }, { serie: 'asc' }] }),
    prisma.emissaoJob.groupBy({ by: ['ambiente', 'serieDPS'], where: { empresaId, reservedDpsNumero: { not: null } }, _max: { reservedDpsNumero: true } }),
    prisma.empresa.findUnique({ where: { id: empresaId }, select: { ultimoDPS: true } }),
  ]);
  // Constant query count, without loading fiscal XML or one history per row.
  const groups = new Map<string, typeof records[number]>();
  const reservedBySeries = new Map<string, number>();
  for (const job of jobs) {
    if (job.serieDPS === null) continue;
    const series = /^[0-9]{1,5}$/.test(job.serieDPS) ? normalizeDpsSeries(job.serieDPS) : job.serieDPS;
    const key = job.ambiente + ':' + series;
    reservedBySeries.set(key, Math.max(reservedBySeries.get(key) ?? 0, job._max.reservedDpsNumero ?? 0));
  }
  for (const record of records) {
    const valid = /^[0-9]{1,5}$/.test(record.serie) && ['PRODUCAO', 'HOMOLOGACAO'].includes(record.ambiente);
    const serie = valid ? normalizeDpsSeries(record.serie) : record.serie;
    const key = record.ambiente + ':' + serie;
    const prior = groups.get(key);
    groups.set(key, { ...(record.serie === serie ? record : prior || record), serie,
      ultimoConfirmado: Math.max(prior?.ultimoConfirmado ?? 0, record.ultimoConfirmado, record.ambiente === 'PRODUCAO' ? company?.ultimoDPS ?? 0 : 0),
      ultimoReservado: Math.max(prior?.ultimoReservado ?? 0, record.ultimoReservado, reservedBySeries.get(key) ?? 0),
      statusSincronizacao: valid ? (prior || record).statusSincronizacao : 'CONFIGURACAO_INVALIDA' });
  }
  return [...groups.values()].map((row) => ({
    id: row.id, empresaId, ambiente: row.ambiente, serie: row.serie, ultimoConfirmado: row.ultimoConfirmado,
    ultimoReservado: row.ultimoReservado, sincronizadoEm: row.sincronizadoEm, origem: row.origem,
    statusSincronizacao: row.statusSincronizacao, atualizadoPor: row.atualizadoPor,
  }));
}

export async function setUserDpsSequence(params: { empresaId: string; ambiente: DpsAmbiente; serie: string; ultimoConfirmado: number; userId: string }) {
  return prisma.$transaction((tx) => setUserDpsSequenceInTransaction(tx, params));
}

export async function getDpsSequence(params: {
  empresaId: string; ambiente: DpsAmbiente; serie: string; fallback?: number;
}) {
  const sequence = await findDpsSequence(params.empresaId, params.ambiente, params.serie);
  return Math.max(sequence?.ultimoConfirmado ?? 0, sequence?.ultimoReservado ?? 0, normalizeDpsNumber(params.fallback ?? 0, true));
}

export async function confirmDpsNumber(params: {
  empresaId: string; ambiente: DpsAmbiente; serie: string; numero: number; origem: string; userId?: string | null;
}) {
  const number = normalizeDpsNumber(params.numero);
  return prisma.$transaction(async (tx) => {
    const sequence = await lockCanonicalDpsSequence(tx, params);
    return tx.dpsSequencia.update({ where: { id: sequence.id }, data: {
      ultimoConfirmado: Math.max(sequence.ultimoConfirmado, number), sincronizadoEm: new Date(),
      origem: params.origem, statusSincronizacao: 'CONFIRMADO', atualizadoPor: params.userId ?? null,
    } });
  });
}

export async function syncDpsSequence(params: {
  empresaId: string;
  ambiente: DpsAmbiente;
  serie: string;
  ultimoConhecido?: number;
  userId: string;
  maxConsultas?: number;
}) {
  const ambiente = normalizeDpsEnvironment(params.ambiente);
  const serie = normalizeDpsSeries(params.serie);
  const maxConsultas = params.maxConsultas ?? 50;
  if (!Number.isInteger(maxConsultas) || maxConsultas < 1 || maxConsultas > 200) throw Object.assign(new Error('Informe entre 1 e 200 consultas.'), { status: 400 });
  const initial = normalizeDpsNumber(params.ultimoConhecido ?? 0, true);
  const empresa = await prisma.empresa.findUnique({ where: { id: params.empresaId } });
  if (!empresa) throw Object.assign(new Error('Empresa não encontrada.'), { status: 404 });
  if (!empresa.certificadoA1 || !empresa.senhaCertificado) {
    throw Object.assign(new Error('Cadastre e valide o certificado A1 antes de sincronizar a DPS.'), { status: 400 });
  }

  const token = crypto.randomUUID();
  const existing = await prisma.$transaction(async (tx) => {
    const sequence = await lockCanonicalDpsSequence(tx, { empresaId: empresa.id, ambiente, serie, forSync: true });
    if (Math.max(sequence.ultimoConfirmado, sequence.ultimoReservado, initial) >= MAX_STORED_DPS_NUMBER) {
      throw Object.assign(new Error('Intervalo de numeração suportado esgotado. Solicite análise; não reinicie a sequência.'), { status: 409 });
    }
    return tx.dpsSequencia.update({ where: { id: sequence.id }, data: {
      syncToken: token, syncLockedUntil: new Date(Date.now() + 5 * 60 * 1000), statusSincronizacao: 'EM_ANDAMENTO',
    } });
  });
  let ultimoOcupado = Math.max(existing.ultimoConfirmado, initial);
  let consultas = 0;
  try {
    for (let numero = ultimoOcupado + 1; consultas < maxConsultas && numero <= MAX_STORED_DPS_NUMBER; numero += 1) {
      const renewed = await prisma.$executeRaw`
        UPDATE "DpsSequencia" SET "syncLockedUntil" = clock_timestamp() + interval '5 minutes'
        WHERE "id" = ${existing.id} AND "syncToken" = ${token} AND "syncLockedUntil" > clock_timestamp()
      `;
      if (renewed !== 1) throw new Error('Sincronização perdeu sua posse. Consulte novamente.');
      const result = await headDps(empresa, ambiente, serie, numero);
      consultas += 1;
      if (!result.exists) {
        const synchronizedRows = await prisma.$queryRaw<DpsSequenceRecord[]>`
          UPDATE "DpsSequencia" SET
            "ultimoConfirmado" = GREATEST("ultimoConfirmado", ${ultimoOcupado}), "sincronizadoEm" = CURRENT_TIMESTAMP,
            "origem" = 'PORTAL_HEAD', "statusSincronizacao" = 'CONFIRMADO',
            "atualizadoPor" = ${params.userId}, "syncToken" = NULL, "syncLockedUntil" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${existing.id} AND "syncToken" = ${token} AND "syncLockedUntil" > clock_timestamp()
          RETURNING *
        `;
        const synchronized = synchronizedRows[0];
        if (!synchronized) throw new Error('Sincronização perdeu sua posse.');
        const nextNumber = nextDpsCandidate(synchronized.ultimoConfirmado, synchronized.ultimoReservado);
        await createLog({
          level: 'INFO',
          action: 'DPS_NUMERACAO_SINCRONIZADA',
          message: `Numeração DPS consultada: série ${serie}, ambiente ${ambiente}, próximo candidato local ${nextNumber}.`,
          empresaId: empresa.id,
          userId: params.userId,
          details: { ambiente, serie, ultimoConfirmado: synchronized.ultimoConfirmado, proximoNumero: nextNumber, consultas },
        });
        return { ...synchronized, proximoNumero: nextNumber, consultas, completo: true };
      }
      ultimoOcupado = numero;
    }

    const partialRows = await prisma.$queryRaw<DpsSequenceRecord[]>`
      UPDATE "DpsSequencia" SET
        "ultimoConfirmado" = GREATEST("ultimoConfirmado", ${ultimoOcupado}), "sincronizadoEm" = CURRENT_TIMESTAMP,
        "origem" = 'PORTAL_HEAD', "statusSincronizacao" = 'PARCIAL',
        "atualizadoPor" = ${params.userId}, "syncToken" = NULL, "syncLockedUntil" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${existing.id} AND "syncToken" = ${token} AND "syncLockedUntil" > clock_timestamp()
      RETURNING *
    `;
    if (!partialRows[0]) throw new Error('Sincronização perdeu sua posse.');
    return { ...partialRows[0], proximoNumero: nextDpsCandidate(partialRows[0].ultimoConfirmado, partialRows[0].ultimoReservado), consultas, completo: false };
  } catch (error) {
    await prisma.$executeRaw`
      UPDATE "DpsSequencia" SET
        "statusSincronizacao" = 'FALHA', "syncToken" = NULL, "syncLockedUntil" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${existing.id} AND "syncToken" = ${token}
    `;
    throw error;
  }
}
