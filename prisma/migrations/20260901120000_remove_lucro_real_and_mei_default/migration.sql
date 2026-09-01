-- Regime tributario deve ser escolhido explicitamente; o SaaS nao atende Lucro Real.
ALTER TABLE "Empresa" ALTER COLUMN "regimeTributario" DROP DEFAULT;

UPDATE "Empresa"
SET "regimeTributario" = NULL,
    "cadastroCompleto" = false
WHERE UPPER(COALESCE("regimeTributario", '')) = 'LUCRO_REAL';

ALTER TABLE "ConfiguracaoSistema" DROP COLUMN "ibsCbsLucroRealAtivo";
