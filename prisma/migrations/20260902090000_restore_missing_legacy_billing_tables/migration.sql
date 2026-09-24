-- Repairs legacy databases whose migration history contains the initial
-- financial schema but where these two additive tables are absent.
-- Existing tables and rows are never replaced or rewritten.
CREATE TABLE IF NOT EXISTS "Fatura" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planoId" TEXT,
    "descricao" TEXT NOT NULL,
    "valorTotal" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "metodo" TEXT NOT NULL DEFAULT 'PIX',
    "txid" TEXT,
    "qrCodePix" TEXT,
    "pagoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Fatura_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CupomLog" (
    "id" TEXT NOT NULL,
    "cupomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "faturaId" TEXT NOT NULL,
    "descontoAplicado" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CupomLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Fatura_userId_idx" ON "Fatura"("userId");
CREATE INDEX IF NOT EXISTS "Fatura_status_idx" ON "Fatura"("status");
CREATE INDEX IF NOT EXISTS "Fatura_txid_idx" ON "Fatura"("txid");
CREATE INDEX IF NOT EXISTS "CupomLog_cupomId_idx" ON "CupomLog"("cupomId");
CREATE INDEX IF NOT EXISTS "CupomLog_userId_idx" ON "CupomLog"("userId");
CREATE INDEX IF NOT EXISTS "CupomLog_faturaId_idx" ON "CupomLog"("faturaId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Fatura_userId_fkey') THEN
    ALTER TABLE "Fatura" ADD CONSTRAINT "Fatura_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Fatura_planoId_fkey') THEN
    ALTER TABLE "Fatura" ADD CONSTRAINT "Fatura_planoId_fkey"
      FOREIGN KEY ("planoId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CupomLog_cupomId_fkey') THEN
    ALTER TABLE "CupomLog" ADD CONSTRAINT "CupomLog_cupomId_fkey"
      FOREIGN KEY ("cupomId") REFERENCES "Cupom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CupomLog_userId_fkey') THEN
    ALTER TABLE "CupomLog" ADD CONSTRAINT "CupomLog_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CupomLog_faturaId_fkey') THEN
    ALTER TABLE "CupomLog" ADD CONSTRAINT "CupomLog_faturaId_fkey"
      FOREIGN KEY ("faturaId") REFERENCES "Fatura"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
