BEGIN;
-- Stop/drain the old HTTP workers before applying. Never guess the outcome of
-- an in-flight legacy POST, nor silently discard an unresolved fiscal operation.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "EmissaoJob" WHERE "status" IN ('PENDENTE','PROCESSANDO','ERRO_TEMPORARIO')) THEN
    RAISE EXCEPTION 'Reconcile and drain legacy emission jobs before deploying the durable worker';
  END IF;
END $$;
ALTER TABLE "DpsSequencia" ADD COLUMN "ultimoReservado" INTEGER NOT NULL DEFAULT 0;
UPDATE "DpsSequencia" s SET "ultimoReservado" = GREATEST(s."ultimoConfirmado",
  COALESCE((SELECT MAX(j."reservedDpsNumero") FROM "EmissaoJob" j
    WHERE j."empresaId" = s."empresaId" AND j."ambiente" = s."ambiente" AND j."serieDPS" = s."serie"), 0));
ALTER TABLE "EmissaoJob"
  ADD COLUMN "signedXml" TEXT,
  ADD COLUMN "dpsId" TEXT,
  ADD COLUMN "preparedMetadataJson" TEXT,
  ADD COLUMN "authorizedXmlBase64" TEXT,
  ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseUntil" TIMESTAMP(3);
-- Legacy terminal records are not new unacknowledged requests.
UPDATE "EmissaoJob" SET "acknowledgedAt" = COALESCE("finishedAt", "updatedAt");
CREATE UNIQUE INDEX "EmissaoJob_one_unacknowledged_request" ON "EmissaoJob" ("actorUserId", "empresaId") WHERE "acknowledgedAt" IS NULL;
CREATE UNIQUE INDEX "EmissaoJob_one_processing_per_company" ON "EmissaoJob" ("empresaId") WHERE "status" = 'PROCESSANDO';
-- New preparations may never reuse a DPS, including one previously rejected.
CREATE UNIQUE INDEX "EmissaoJob_prepared_dps_key" ON "EmissaoJob" ("empresaId", "ambiente", "dpsId") WHERE "dpsId" IS NOT NULL;
CREATE INDEX "EmissaoJob_status_nextAttemptAt_leaseUntil_idx" ON "EmissaoJob" ("status", "nextAttemptAt", "leaseUntil");
CREATE TABLE "EmissionDocumentTask" (
  "id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDENTE', "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT, "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmissionDocumentTask_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "EmissaoJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmissionDocumentTask_jobId_key" ON "EmissionDocumentTask" ("jobId");
CREATE INDEX "EmissionDocumentTask_status_nextAttemptAt_leaseUntil_idx" ON "EmissionDocumentTask" ("status", "nextAttemptAt", "leaseUntil");
CREATE TABLE "WorkerHeartbeat" (
  "id" TEXT NOT NULL PRIMARY KEY, "updatedAt" TIMESTAMP(3) NOT NULL,
  "productionEnabled" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "EmissionRequestBlock" (
  "id" TEXT NOT NULL PRIMARY KEY, "empresaId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "EmissionRequestBlock_empresaId_idempotencyKey_key" ON "EmissionRequestBlock" ("empresaId", "idempotencyKey");
COMMIT;
