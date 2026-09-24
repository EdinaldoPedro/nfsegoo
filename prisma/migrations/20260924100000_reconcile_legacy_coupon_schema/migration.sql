-- Reconcile restored legacy databases whose migration history predates the current
-- commercial coupon shape. Existing legacy columns are preserved for rollback and audit.
ALTER TABLE "Cupom"
  ADD COLUMN IF NOT EXISTS "tipoDesconto" TEXT,
  ADD COLUMN IF NOT EXISTS "valorDesconto" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "limiteUsos" INTEGER,
  ADD COLUMN IF NOT EXISTS "vezesUsado" INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "aplicarEm" TEXT DEFAULT 'CARRINHO_TOTAL',
  ADD COLUMN IF NOT EXISTS "maxCiclos" INTEGER,
  ADD COLUMN IF NOT EXISTS "parceiroNome" TEXT,
  ADD COLUMN IF NOT EXISTS "planosValidos" TEXT,
  ADD COLUMN IF NOT EXISTS "apenasPrimeiraCompra" BOOLEAN DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Cupom'
      AND column_name IN ('descontoPct', 'descontoFixo')
    GROUP BY table_schema, table_name HAVING COUNT(*) = 2
  ) THEN
    EXECUTE 'UPDATE "Cupom" SET "tipoDesconto" = CASE
      WHEN "descontoPct" IS NOT NULL THEN ''PORCENTAGEM''
      WHEN "descontoFixo" IS NOT NULL THEN ''VALOR_FIXO''
      ELSE ''PORCENTAGEM'' END
      WHERE "tipoDesconto" IS NULL';
    EXECUTE 'UPDATE "Cupom" SET "valorDesconto" = COALESCE("descontoPct", "descontoFixo", 0)
      WHERE "valorDesconto" IS NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Cupom' AND column_name = 'quantidade'
  ) THEN
    EXECUTE 'UPDATE "Cupom" SET "limiteUsos" = "quantidade" WHERE "limiteUsos" IS NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Cupom' AND column_name = 'usos'
  ) THEN
    EXECUTE 'UPDATE "Cupom" SET "vezesUsado" = COALESCE("usos", 0) WHERE "vezesUsado" IS NULL';
  END IF;
END $$;

UPDATE "Cupom" SET
  "tipoDesconto" = COALESCE("tipoDesconto", 'PORCENTAGEM'),
  "valorDesconto" = COALESCE("valorDesconto", 0),
  "vezesUsado" = COALESCE("vezesUsado", 0),
  "aplicarEm" = COALESCE("aplicarEm", 'CARRINHO_TOTAL'),
  "apenasPrimeiraCompra" = COALESCE("apenasPrimeiraCompra", false);

ALTER TABLE "Cupom"
  ALTER COLUMN "tipoDesconto" SET NOT NULL,
  ALTER COLUMN "valorDesconto" SET NOT NULL,
  ALTER COLUMN "vezesUsado" SET DEFAULT 0,
  ALTER COLUMN "vezesUsado" SET NOT NULL,
  ALTER COLUMN "aplicarEm" SET DEFAULT 'CARRINHO_TOTAL',
  ALTER COLUMN "aplicarEm" SET NOT NULL,
  ALTER COLUMN "apenasPrimeiraCompra" SET DEFAULT false,
  ALTER COLUMN "apenasPrimeiraCompra" SET NOT NULL;
