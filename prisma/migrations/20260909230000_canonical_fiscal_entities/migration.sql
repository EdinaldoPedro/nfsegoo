-- The public CNPJ identity is global. Cliente remains the private relationship
-- owned by one issuer, preserving every existing fiscal/history foreign key.
CREATE TABLE "EntidadeFiscal" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'PJ',
    "documento" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "situacaoCadastral" TEXT,
    "emailPublico" TEXT,
    "telefonePublico" TEXT,
    "cep" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "pais" TEXT NOT NULL DEFAULT 'Brasil',
    "codigoIbge" TEXT,
    "fonte" TEXT NOT NULL DEFAULT 'LEGADO',
    "fonteConsultadaEm" TIMESTAMP(3),
    "fontePayloadHash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntidadeFiscal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntidadeFiscalAtividade" (
    "id" TEXT NOT NULL,
    "entidadeFiscalId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntidadeFiscalAtividade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntidadeFiscalCorrecao" (
    "id" TEXT NOT NULL,
    "entidadeFiscalId" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "valor" TEXT,
    "justificativa" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntidadeFiscalCorrecao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntidadeFiscalEvento" (
    "id" TEXT NOT NULL,
    "entidadeFiscalId" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "camposAlterados" TEXT NOT NULL,
    "snapshotJson" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntidadeFiscalEvento_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Cliente" ADD COLUMN "entidadeFiscalId" TEXT;

CREATE UNIQUE INDEX "EntidadeFiscal_documento_key" ON "EntidadeFiscal"("documento");
CREATE INDEX "EntidadeFiscal_razaoSocial_idx" ON "EntidadeFiscal"("razaoSocial");
CREATE INDEX "EntidadeFiscal_updatedAt_idx" ON "EntidadeFiscal"("updatedAt");
CREATE UNIQUE INDEX "EntidadeFiscalAtividade_entidadeFiscalId_codigo_key" ON "EntidadeFiscalAtividade"("entidadeFiscalId", "codigo");
CREATE INDEX "EntidadeFiscalAtividade_codigo_idx" ON "EntidadeFiscalAtividade"("codigo");
CREATE UNIQUE INDEX "EntidadeFiscalCorrecao_entidadeFiscalId_campo_key" ON "EntidadeFiscalCorrecao"("entidadeFiscalId", "campo");
CREATE INDEX "EntidadeFiscalCorrecao_actorUserId_updatedAt_idx" ON "EntidadeFiscalCorrecao"("actorUserId", "updatedAt");
CREATE INDEX "EntidadeFiscalEvento_entidadeFiscalId_createdAt_idx" ON "EntidadeFiscalEvento"("entidadeFiscalId", "createdAt");
CREATE INDEX "EntidadeFiscalEvento_actorUserId_createdAt_idx" ON "EntidadeFiscalEvento"("actorUserId", "createdAt");
CREATE INDEX "Cliente_entidadeFiscalId_idx" ON "Cliente"("entidadeFiscalId");

ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_entidadeFiscalId_fkey" FOREIGN KEY ("entidadeFiscalId") REFERENCES "EntidadeFiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntidadeFiscalAtividade" ADD CONSTRAINT "EntidadeFiscalAtividade_entidadeFiscalId_fkey" FOREIGN KEY ("entidadeFiscalId") REFERENCES "EntidadeFiscal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntidadeFiscalCorrecao" ADD CONSTRAINT "EntidadeFiscalCorrecao_entidadeFiscalId_fkey" FOREIGN KEY ("entidadeFiscalId") REFERENCES "EntidadeFiscal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntidadeFiscalCorrecao" ADD CONSTRAINT "EntidadeFiscalCorrecao_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntidadeFiscalEvento" ADD CONSTRAINT "EntidadeFiscalEvento_entidadeFiscalId_fkey" FOREIGN KEY ("entidadeFiscalId") REFERENCES "EntidadeFiscal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntidadeFiscalEvento" ADD CONSTRAINT "EntidadeFiscalEvento_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deterministic backfill: the most recently edited relationship seeds the
-- public identity. All relationship rows and their private fields stay intact.
WITH source AS (
    SELECT DISTINCT ON ("documento")
        "documento", "nome", "nomeFantasia", "cep", "logradouro", "numero",
        "complemento", "bairro", "cidade", "uf", "pais", "codigoIbge",
        "createdAt", "updatedAt"
    FROM "Cliente"
    WHERE "tipo" = 'PJ'
      AND "documento" IS NOT NULL
      AND "documento" ~ '^[A-Z0-9]{12}[0-9]{2}$'
    ORDER BY "documento", "updatedAt" DESC, "id" ASC
)
INSERT INTO "EntidadeFiscal" (
    "id", "documento", "razaoSocial", "nomeFantasia", "cep", "logradouro",
    "numero", "complemento", "bairro", "cidade", "uf", "pais", "codigoIbge",
    "fonte", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text, "documento", "nome", "nomeFantasia", "cep",
       "logradouro", "numero", "complemento", "bairro", "cidade", "uf",
       COALESCE(NULLIF("pais", ''), 'Brasil'), "codigoIbge", 'LEGACY_BACKFILL',
       "createdAt", "updatedAt"
FROM source;

UPDATE "Cliente" AS c
SET "entidadeFiscalId" = e."id"
FROM "EntidadeFiscal" AS e
WHERE c."tipo" = 'PJ' AND c."documento" = e."documento";

INSERT INTO "EntidadeFiscalEvento" ("id", "entidadeFiscalId", "origem", "camposAlterados", "snapshotJson")
SELECT gen_random_uuid()::text, e."id", 'MIGRACAO', '["identidadeInicial"]',
       json_build_object('documento', e."documento", 'razaoSocial', e."razaoSocial", 'fonte', e."fonte")::text
FROM "EntidadeFiscal" e;

-- Local development commonly uses nfse_admin while migrations can be applied
-- by the database owner. Grant only the CRUD permissions needed by the app.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nfse_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "EntidadeFiscal", "EntidadeFiscalAtividade", "EntidadeFiscalCorrecao", "EntidadeFiscalEvento" TO nfse_admin;
  END IF;
END $$;
