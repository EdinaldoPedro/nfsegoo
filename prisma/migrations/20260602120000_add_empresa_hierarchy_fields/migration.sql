ALTER TABLE "Empresa" ADD COLUMN "contadorCustodianteId" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "modoCobranca" TEXT NOT NULL DEFAULT 'RESPONSAVEL_UNICO';
ALTER TABLE "Empresa" ADD COLUMN "statusPropriedade" TEXT NOT NULL DEFAULT 'ORFA';

ALTER TABLE "ContadorVinculo" ADD COLUMN "clientePodeAcessarPortal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ContadorVinculo" ADD COLUMN "nivelPortal" TEXT NOT NULL DEFAULT 'NENHUM';

CREATE INDEX "Empresa_donoFaturamentoId_idx" ON "Empresa"("donoFaturamentoId");
CREATE INDEX "Empresa_contadorCustodianteId_idx" ON "Empresa"("contadorCustodianteId");
CREATE INDEX "Empresa_statusPropriedade_idx" ON "Empresa"("statusPropriedade");

ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_contadorCustodianteId_fkey"
FOREIGN KEY ("contadorCustodianteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
