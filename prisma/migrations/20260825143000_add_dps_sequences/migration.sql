CREATE TABLE "DpsSequencia" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "ambiente" TEXT NOT NULL,
  "serie" TEXT NOT NULL,
  "ultimoConfirmado" INTEGER NOT NULL DEFAULT 0,
  "sincronizadoEm" TIMESTAMP(3),
  "origem" TEXT NOT NULL DEFAULT 'MANUAL',
  "statusSincronizacao" TEXT NOT NULL DEFAULT 'NAO_SINCRONIZADO',
  "atualizadoPor" TEXT,
  "syncToken" TEXT,
  "syncLockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DpsSequencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DpsSequencia_empresaId_ambiente_serie_key"
  ON "DpsSequencia"("empresaId", "ambiente", "serie");
CREATE INDEX "DpsSequencia_empresaId_ambiente_idx"
  ON "DpsSequencia"("empresaId", "ambiente");

ALTER TABLE "DpsSequencia"
  ADD CONSTRAINT "DpsSequencia_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "DpsSequencia" (
  "id", "empresaId", "ambiente", "serie", "ultimoConfirmado", "origem",
  "statusSincronizacao", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  empresa."id",
  'PRODUCAO',
  COALESCE(NULLIF(TRIM(empresa."serieDPS"), ''), '1'),
  GREATEST(empresa."ultimoDPS", 0),
  'LEGADO',
  'IMPORTADO',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Empresa" AS empresa
WHERE empresa."ultimoDPS" > 0
ON CONFLICT ("empresaId", "ambiente", "serie") DO NOTHING;

INSERT INTO "DpsSequencia" (
  "id", "empresaId", "ambiente", "serie", "ultimoConfirmado", "sincronizadoEm",
  "origem", "statusSincronizacao", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  job."empresaId",
  'HOMOLOGACAO',
  COALESCE(NULLIF(TRIM(job."serieDPS"), ''), '900'),
  MAX(job."reservedDpsNumero"),
  MAX(job."finishedAt"),
  'HISTORICO_HOMOLOGACAO',
  'CONFIRMADO',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "EmissaoJob" AS job
WHERE job."status" = 'AUTORIZADA'
  AND job."resultNotaId" IS NULL
  AND job."reservedDpsNumero" IS NOT NULL
  AND job."statusMessage" LIKE '%homologacao%'
GROUP BY job."empresaId", COALESCE(NULLIF(TRIM(job."serieDPS"), ''), '900')
ON CONFLICT ("empresaId", "ambiente", "serie")
DO UPDATE SET
  "ultimoConfirmado" = GREATEST("DpsSequencia"."ultimoConfirmado", EXCLUDED."ultimoConfirmado"),
  "sincronizadoEm" = EXCLUDED."sincronizadoEm",
  "origem" = EXCLUDED."origem",
  "statusSincronizacao" = EXCLUDED."statusSincronizacao",
  "updatedAt" = CURRENT_TIMESTAMP;
