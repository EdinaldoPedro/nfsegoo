ALTER TABLE "Empresa"
  ADD COLUMN "certificadoCnpj" TEXT,
  ADD COLUMN "certificadoFingerprintSha256" TEXT,
  ADD COLUMN "certificadoValidadoEm" TIMESTAMP(3),
  ADD COLUMN "certificadoChainStatus" TEXT,
  ADD COLUMN "certificadoCnpjSource" TEXT;

CREATE INDEX "Empresa_certificadoVencimento_idx" ON "Empresa"("certificadoVencimento");
CREATE INDEX "Empresa_certificadoChainStatus_idx" ON "Empresa"("certificadoChainStatus");
