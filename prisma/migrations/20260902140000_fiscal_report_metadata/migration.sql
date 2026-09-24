-- Additive metadata only. Do not infer environment or tax codes for old XML.
ALTER TABLE "NotaFiscal" ADD COLUMN "tomadorNome" TEXT;
ALTER TABLE "NotaFiscal" ADD COLUMN "metadadosVerificadosEm" TIMESTAMP(3);
CREATE INDEX "NotaFiscal_empresaId_ambiente_dataEmissao_id_idx"
  ON "NotaFiscal" ("empresaId", "ambiente", "dataEmissao", "id");
CREATE INDEX "NotaFiscal_legacy_date_report_idx"
  ON "NotaFiscal" ("empresaId", "ambiente", "createdAt", "id")
  WHERE "dataEmissao" IS NULL AND "arquivadoEm" IS NULL;
