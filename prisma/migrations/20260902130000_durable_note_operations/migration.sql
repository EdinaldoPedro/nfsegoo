BEGIN;

ALTER TABLE "NotaFiscal" ADD COLUMN "numeroOficial" TEXT, ADD COLUMN "ambiente" TEXT, ADD COLUMN "dataCancelamento" TIMESTAMP(3);
UPDATE "NotaFiscal" SET "numeroOficial" = "numero"::text WHERE "numero" > 0;
-- Historical environments are not inferred from today's company settings.
UPDATE "NotaFiscal" n SET "ambiente" = j."ambiente" FROM "EmissaoJob" j
WHERE j."resultNotaId" = n."id" AND j."status" = 'AUTORIZADA' AND j."signedXml" IS NOT NULL AND j."ambiente" IN ('PRODUCAO', 'HOMOLOGACAO');
CREATE UNIQUE INDEX "NotaFiscal_id_empresaId_key" ON "NotaFiscal"("id", "empresaId");
ALTER TABLE "EmissionDocumentTask" ADD COLUMN "notaId" TEXT, ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
UPDATE "EmissionDocumentTask" t SET "notaId" = j."resultNotaId" FROM "EmissaoJob" j WHERE j."id" = t."jobId";
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "EmissionDocumentTask" t LEFT JOIN "NotaFiscal" n ON n."id" = t."notaId" WHERE n."id" IS NULL) THEN
    RAISE EXCEPTION 'Reconcile document tasks without an authorized invoice before migrating; do not delete fiscal history.';
  END IF;
END $$;
ALTER TABLE "EmissionDocumentTask" ALTER COLUMN "notaId" SET NOT NULL, ALTER COLUMN "jobId" DROP NOT NULL;
CREATE UNIQUE INDEX "EmissionDocumentTask_notaId_key" ON "EmissionDocumentTask"("notaId");
ALTER TABLE "EmissionDocumentTask" ADD CONSTRAINT "EmissionDocumentTask_notaId_fkey" FOREIGN KEY ("notaId") REFERENCES "NotaFiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FiscalNoteOperation" (
  "id" TEXT NOT NULL PRIMARY KEY, "notaId" TEXT NOT NULL, "empresaId" TEXT NOT NULL, "actorUserId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL CHECK ("tipo" IN ('CANCELAR', 'CONSULTAR')),
  "ambiente" TEXT NOT NULL CHECK ("ambiente" IN ('PRODUCAO', 'HOMOLOGACAO')),
  "chaveAcesso" TEXT NOT NULL CHECK ("chaveAcesso" ~ '^[0-9]{50}$'), "issuerDocument" TEXT NOT NULL,
  "originalXmlHash" TEXT, "idempotencyKey" TEXT NOT NULL, "reasonCode" TEXT, "justification" TEXT,
  "signedRequestXml" TEXT, "transmissionStartedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDENTE' CHECK ("status" IN ('PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO', 'CONCLUIDA', 'ERRO_FINAL', 'RECONCILIACAO_MANUAL')),
  "statusMessage" TEXT, "resultStatus" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0, "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "nextAttemptAt" TIMESTAMP(3), "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FiscalNoteOperation_notaId_empresaId_fkey" FOREIGN KEY ("notaId", "empresaId") REFERENCES "NotaFiscal"("id", "empresaId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FiscalNoteOperation_cancel_reason_check" CHECK ("tipo" <> 'CANCELAR' OR ("reasonCode" IS NOT NULL AND "justification" IS NOT NULL AND "originalXmlHash" IS NOT NULL AND "reasonCode" IN ('1','2','9') AND char_length("justification") BETWEEN 15 AND 255)),
  CONSTRAINT "FiscalNoteOperation_transmission_check" CHECK ("transmissionStartedAt" IS NULL OR ("tipo" = 'CANCELAR' AND "signedRequestXml" IS NOT NULL))
);
CREATE UNIQUE INDEX "FiscalNoteOperation_notaId_idempotencyKey_key" ON "FiscalNoteOperation"("notaId", "idempotencyKey");
CREATE UNIQUE INDEX "FiscalNoteOperation_one_active_note" ON "FiscalNoteOperation"("notaId") WHERE "status" IN ('PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO', 'RECONCILIACAO_MANUAL');
CREATE UNIQUE INDEX "FiscalNoteOperation_one_active_key" ON "FiscalNoteOperation"("ambiente", "chaveAcesso") WHERE "status" IN ('PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO', 'RECONCILIACAO_MANUAL');
CREATE INDEX "FiscalNoteOperation_notaId_createdAt_idx" ON "FiscalNoteOperation"("notaId", "createdAt");
CREATE INDEX "FiscalNoteOperation_empresaId_status_createdAt_idx" ON "FiscalNoteOperation"("empresaId", "status", "createdAt");
CREATE INDEX "FiscalNoteOperation_status_nextAttemptAt_leaseUntil_idx" ON "FiscalNoteOperation"("status", "nextAttemptAt", "leaseUntil");
COMMIT;
