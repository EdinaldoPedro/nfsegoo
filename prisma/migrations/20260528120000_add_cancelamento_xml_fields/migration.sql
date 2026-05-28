-- Preserve fiscal XML documents separately so cancellations can export
-- the authorized NFS-e XML and the cancellation event XML together.
ALTER TABLE "NotaFiscal" ADD COLUMN "xmlAutorizadoBase64" TEXT;
ALTER TABLE "NotaFiscal" ADD COLUMN "xmlCancelamentoEventoBase64" TEXT;

UPDATE "NotaFiscal"
SET "xmlAutorizadoBase64" = "xmlBase64"
WHERE "xmlAutorizadoBase64" IS NULL
  AND "xmlBase64" IS NOT NULL
  AND "status" IN ('AUTORIZADA', 'CANCELADA');
