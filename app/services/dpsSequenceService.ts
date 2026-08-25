import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import { prisma } from '@/app/utils/prisma';
import { openEmpresaCertificate } from '@/app/services/certificateVault';
import { createLog } from '@/app/services/logger';

export type DpsAmbiente = 'HOMOLOGACAO' | 'PRODUCAO';

export interface DpsSequenceRecord {
  id: string;
  empresaId: string;
  ambiente: string;
  serie: string;
  ultimoConfirmado: number;
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

export function normalizeDpsEnvironment(value: unknown): DpsAmbiente {
  return String(value || '').toUpperCase() === 'PRODUCAO' ? 'PRODUCAO' : 'HOMOLOGACAO';
}

export function normalizeDpsSeries(value: unknown) {
  const serie = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,5}$/.test(serie)) {
    throw Object.assign(new Error('A série da DPS deve possuir de 1 a 5 letras ou números.'), { status: 400 });
  }
  return serie;
}

function buildDpsId(empresa: any, serie: string, numero: number) {
  const municipio = digits(empresa.codigoIbge);
  const documento = digits(empresa.documento);
  if (municipio.length !== 7) throw Object.assign(new Error('Código IBGE do município emissor inválido.'), { status: 400 });
  if (![11, 14].includes(documento.length)) throw Object.assign(new Error('CPF/CNPJ do prestador inválido.'), { status: 400 });

  const tipoInscricao = documento.length === 14 ? '2' : '1';
  const inscricao = documento.padStart(14, '0');
  return `DPS${municipio}${tipoInscricao}${inscricao}${serie.padStart(5, '0')}${String(numero).padStart(15, '0')}`;
}

function isTransientStatus(status?: number) {
  return status === 408 || status === 425 || status === 429 || Boolean(status && status >= 500);
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function headDps(empresa: any, ambiente: DpsAmbiente, serie: string, numero: number) {
  const credentials = openEmpresaCertificate({
    empresaId: empresa.id,
    certificadoA1: empresa.certificadoA1,
    senhaCertificado: empresa.senhaCertificado,
    purpose: 'CONSULT_DPS',
  });
  const idDps = buildDpsId(empresa, serie, numero);
  const url = `${BASE_URLS[ambiente]}/dps/${idDps}`;
  const httpsAgent = new https.Agent({
    cert: credentials.cert,
    key: credentials.key,
    rejectUnauthorized: true,
    keepAlive: true,
    family: 4,
  });
  const authorization = Buffer.from(`${digits(empresa.documento)}:${credentials.senha}`).toString('base64');

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await axios.head(url, {
        headers: { Authorization: `Basic ${authorization}` },
        httpsAgent,
        timeout: 12000,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) return { exists: true, idDps, status: response.status };
      if (response.status === 404) return { exists: false, idDps, status: response.status };
      if (!isTransientStatus(response.status)) {
        throw Object.assign(new Error(`O Portal recusou a consulta da DPS (HTTP ${response.status}).`), { portalStatus: response.status });
      }
      if (attempt === 3) throw new Error(`Portal indisponível para consulta da DPS (HTTP ${response.status}).`);
    } catch (error: any) {
      if (error?.portalStatus || attempt === 3) throw error;
    }
    await wait(400 * attempt);
  }

  throw new Error('Não foi possível consultar a DPS no Portal Nacional.');
}

export async function findDpsSequence(empresaId: string, ambiente: DpsAmbiente, serie: string) {
  const rows = await prisma.$queryRaw<DpsSequenceRecord[]>`
    SELECT * FROM "DpsSequencia"
    WHERE "empresaId" = ${empresaId} AND "ambiente" = ${ambiente} AND "serie" = ${serie}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function listDpsSequences(empresaId: string) {
  return prisma.$queryRaw<Array<Pick<DpsSequenceRecord, 'id' | 'empresaId' | 'ambiente' | 'serie' | 'ultimoConfirmado' | 'sincronizadoEm' | 'origem' | 'statusSincronizacao' | 'atualizadoPor'>>[]>`
    SELECT "id", "empresaId", "ambiente", "serie", "ultimoConfirmado", "sincronizadoEm",
      "origem", "statusSincronizacao", "atualizadoPor"
    FROM "DpsSequencia" WHERE "empresaId" = ${empresaId}
    ORDER BY "ambiente", "serie"
  `;
}

export async function setUserDpsSequence(params: { empresaId: string; ambiente: DpsAmbiente; serie: string; ultimoConfirmado: number; userId: string }) {
  const existing = await findDpsSequence(params.empresaId, params.ambiente, params.serie);
  const safeNumber = Math.max(existing?.ultimoConfirmado || 0, params.ultimoConfirmado);
  if (existing?.ultimoConfirmado === safeNumber) return existing;
  const id = existing?.id || crypto.randomUUID();
  const rows = await prisma.$queryRaw<DpsSequenceRecord[]>`
    INSERT INTO "DpsSequencia" (
      "id", "empresaId", "ambiente", "serie", "ultimoConfirmado", "origem",
      "statusSincronizacao", "atualizadoPor", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${params.empresaId}, ${params.ambiente}, ${params.serie}, ${safeNumber},
      'CONFIGURACAO_USUARIO', 'INFORMADO', ${params.userId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("empresaId", "ambiente", "serie") DO UPDATE SET
      "ultimoConfirmado" = EXCLUDED."ultimoConfirmado",
      "origem" = EXCLUDED."origem",
      "statusSincronizacao" = EXCLUDED."statusSincronizacao",
      "atualizadoPor" = EXCLUDED."atualizadoPor",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING *
  `;
  return rows[0];
}

export async function getDpsSequence(params: {
  empresaId: string;
  ambiente: DpsAmbiente;
  serie: string;
  fallback?: number;
}) {
  const serie = normalizeDpsSeries(params.serie);
  const sequence = await findDpsSequence(params.empresaId, params.ambiente, serie);
  return sequence?.ultimoConfirmado ?? Math.max(0, Number(params.fallback || 0));
}

export async function confirmDpsNumber(params: {
  empresaId: string;
  ambiente: DpsAmbiente;
  serie: string;
  numero: number;
  origem: string;
  userId?: string | null;
}) {
  const serie = normalizeDpsSeries(params.serie);
  const numero = Math.max(0, Math.trunc(params.numero));
  const existing = await findDpsSequence(params.empresaId, params.ambiente, serie);
  const confirmedNumber = Math.max(numero, existing?.ultimoConfirmado || 0);
  const id = existing?.id || crypto.randomUUID();
  const rows = await prisma.$queryRaw<DpsSequenceRecord[]>`
    INSERT INTO "DpsSequencia" (
      "id", "empresaId", "ambiente", "serie", "ultimoConfirmado", "sincronizadoEm",
      "origem", "statusSincronizacao", "atualizadoPor", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${params.empresaId}, ${params.ambiente}, ${serie}, ${confirmedNumber}, CURRENT_TIMESTAMP,
      ${params.origem}, 'CONFIRMADO', ${params.userId || null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("empresaId", "ambiente", "serie") DO UPDATE SET
      "ultimoConfirmado" = GREATEST("DpsSequencia"."ultimoConfirmado", EXCLUDED."ultimoConfirmado"),
      "sincronizadoEm" = CURRENT_TIMESTAMP,
      "origem" = EXCLUDED."origem",
      "statusSincronizacao" = 'CONFIRMADO',
      "atualizadoPor" = EXCLUDED."atualizadoPor",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING *
  `;
  return rows[0];
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
  const maxConsultas = Math.min(Math.max(Math.trunc(params.maxConsultas || 50), 1), 200);
  const empresa = await prisma.empresa.findUnique({ where: { id: params.empresaId } });
  if (!empresa) throw Object.assign(new Error('Empresa não encontrada.'), { status: 404 });
  if (!empresa.certificadoA1 || !empresa.senhaCertificado) {
    throw Object.assign(new Error('Cadastre e valide o certificado A1 antes de sincronizar a DPS.'), { status: 400 });
  }

  let existing = await findDpsSequence(empresa.id, ambiente, serie);
  if (!existing) {
    const id = crypto.randomUUID();
    const initial = Math.max(0, Math.trunc(params.ultimoConhecido || 0));
    const rows = await prisma.$queryRaw<DpsSequenceRecord[]>`
      INSERT INTO "DpsSequencia" (
        "id", "empresaId", "ambiente", "serie", "ultimoConfirmado", "createdAt", "updatedAt"
      ) VALUES (${id}, ${empresa.id}, ${ambiente}, ${serie}, ${initial}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("empresaId", "ambiente", "serie") DO UPDATE SET "updatedAt" = "DpsSequencia"."updatedAt"
      RETURNING *
    `;
    existing = rows[0];
  }
  const token = crypto.randomUUID();
  const now = new Date();
  const lockUntil = new Date(Date.now() + 5 * 60 * 1000);
  const locked = await prisma.$executeRaw`
    UPDATE "DpsSequencia" SET
      "syncToken" = ${token}, "syncLockedUntil" = ${lockUntil},
      "statusSincronizacao" = 'EM_ANDAMENTO', "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${existing.id}
      AND ("syncLockedUntil" IS NULL OR "syncLockedUntil" < ${now})
  `;
  if (locked !== 1) {
    throw Object.assign(new Error('Já existe uma sincronização em andamento para este ambiente e série.'), { status: 409 });
  }

  let ultimoOcupado = Math.max(existing.ultimoConfirmado, Math.max(0, Math.trunc(params.ultimoConhecido || 0)));
  let consultas = 0;
  try {
    for (let numero = ultimoOcupado + 1; consultas < maxConsultas; numero += 1) {
      const result = await headDps(empresa, ambiente, serie, numero);
      consultas += 1;
      if (!result.exists) {
        const synchronizedRows = await prisma.$queryRaw<DpsSequenceRecord[]>`
          UPDATE "DpsSequencia" SET
            "ultimoConfirmado" = ${ultimoOcupado}, "sincronizadoEm" = CURRENT_TIMESTAMP,
            "origem" = 'PORTAL_HEAD', "statusSincronizacao" = 'CONFIRMADO',
            "atualizadoPor" = ${params.userId}, "syncToken" = NULL, "syncLockedUntil" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${existing.id} AND "syncToken" = ${token}
          RETURNING *
        `;
        const synchronized = synchronizedRows[0];
        await createLog({
          level: 'INFO',
          action: 'DPS_NUMERACAO_SINCRONIZADA',
          message: `Numeração DPS sincronizada: série ${serie}, ambiente ${ambiente}, próximo número ${numero}.`,
          empresaId: empresa.id,
          userId: params.userId,
          details: { ambiente, serie, ultimoConfirmado: ultimoOcupado, proximoNumero: numero, consultas },
        });
        return { ...synchronized, proximoNumero: numero, consultas, completo: true };
      }
      ultimoOcupado = numero;
    }

    await prisma.$executeRaw`
      UPDATE "DpsSequencia" SET
        "ultimoConfirmado" = ${ultimoOcupado}, "sincronizadoEm" = CURRENT_TIMESTAMP,
        "origem" = 'PORTAL_HEAD', "statusSincronizacao" = 'PARCIAL',
        "atualizadoPor" = ${params.userId}, "syncToken" = NULL, "syncLockedUntil" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${existing.id} AND "syncToken" = ${token}
    `;
    return { ambiente, serie, ultimoConfirmado: ultimoOcupado, proximoNumero: ultimoOcupado + 1, consultas, completo: false };
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
