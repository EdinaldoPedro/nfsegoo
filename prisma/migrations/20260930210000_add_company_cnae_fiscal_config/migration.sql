CREATE TABLE "EmpresaCnaeConfiguracaoFiscal" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "cnaeId" TEXT NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT false,
  "configuracao" JSONB NOT NULL,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "atualizadoPor" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmpresaCnaeConfiguracaoFiscal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmpresaCnaeConfiguracaoFiscal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EmpresaCnaeConfiguracaoFiscal_cnaeId_fkey" FOREIGN KEY ("cnaeId") REFERENCES "Cnae"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EmpresaCnaeConfiguracaoFiscal_atualizadoPor_fkey" FOREIGN KEY ("atualizadoPor") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmpresaCnaeConfiguracaoFiscal_cnaeId_key" ON "EmpresaCnaeConfiguracaoFiscal"("cnaeId");
CREATE INDEX "EmpresaCnaeConfiguracaoFiscal_empresaId_ativo_idx" ON "EmpresaCnaeConfiguracaoFiscal"("empresaId", "ativo");
