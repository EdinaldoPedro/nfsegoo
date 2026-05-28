-- Soft archive fields for fiscal and operational records.
-- UI actions can still say "Excluir", but records remain available for audit/history.
ALTER TABLE "Empresa" ADD COLUMN "arquivadoEm" TIMESTAMP(3);
ALTER TABLE "Empresa" ADD COLUMN "arquivadoPor" TEXT;
ALTER TABLE "Empresa" ADD COLUMN "motivoArquivamento" TEXT;

ALTER TABLE "Cliente" ADD COLUMN "arquivadoEm" TIMESTAMP(3);
ALTER TABLE "Cliente" ADD COLUMN "arquivadoPor" TEXT;
ALTER TABLE "Cliente" ADD COLUMN "motivoArquivamento" TEXT;

ALTER TABLE "VinculoCarteira" ADD COLUMN "arquivadoEm" TIMESTAMP(3);
ALTER TABLE "VinculoCarteira" ADD COLUMN "arquivadoPor" TEXT;
ALTER TABLE "VinculoCarteira" ADD COLUMN "motivoArquivamento" TEXT;

ALTER TABLE "Venda" ADD COLUMN "arquivadoEm" TIMESTAMP(3);
ALTER TABLE "Venda" ADD COLUMN "arquivadoPor" TEXT;
ALTER TABLE "Venda" ADD COLUMN "motivoArquivamento" TEXT;

ALTER TABLE "NotaFiscal" ADD COLUMN "arquivadoEm" TIMESTAMP(3);
ALTER TABLE "NotaFiscal" ADD COLUMN "arquivadoPor" TEXT;
ALTER TABLE "NotaFiscal" ADD COLUMN "motivoArquivamento" TEXT;

ALTER TABLE "PlanHistory" ADD COLUMN "arquivadoEm" TIMESTAMP(3);
ALTER TABLE "PlanHistory" ADD COLUMN "arquivadoPor" TEXT;
ALTER TABLE "PlanHistory" ADD COLUMN "motivoArquivamento" TEXT;

ALTER TABLE "Ticket" ADD COLUMN "arquivadoEm" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "arquivadoPor" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "motivoArquivamento" TEXT;

ALTER TABLE "ContadorVinculo" ADD COLUMN "arquivadoEm" TIMESTAMP(3);
ALTER TABLE "ContadorVinculo" ADD COLUMN "arquivadoPor" TEXT;
ALTER TABLE "ContadorVinculo" ADD COLUMN "motivoArquivamento" TEXT;

ALTER TABLE "Pedido" ADD COLUMN "arquivadoEm" TIMESTAMP(3);
ALTER TABLE "Pedido" ADD COLUMN "arquivadoPor" TEXT;
ALTER TABLE "Pedido" ADD COLUMN "motivoArquivamento" TEXT;
