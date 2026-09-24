BEGIN;

-- Apply with the emission worker stopped and legacy in-flight work reconciled.
-- Guessing whether a timed-out fiscal transmission was authorized is unsafe.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "EmissaoJob" WHERE "status" IN ('PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO')) THEN
    RAISE EXCEPTION 'Reconcile/drain legacy in-flight emission jobs before enabling the credit ledger; do not delete jobs to bypass this gate.';
  END IF;
END $$;

CREATE TABLE "PlanUsageCycle" (
  "id" TEXT NOT NULL,
  "historyId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "used" INTEGER NOT NULL DEFAULT 0 CHECK ("used" >= 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanUsageCycle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlanUsageCycle_historyId_fkey" FOREIGN KEY ("historyId") REFERENCES "PlanHistory"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlanUsageCycle_historyId_startsAt_key" ON "PlanUsageCycle"("historyId", "startsAt");
CREATE INDEX "PlanUsageCycle_historyId_endsAt_idx" ON "PlanUsageCycle"("historyId", "endsAt");

CREATE TABLE "EmissionCreditReservation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RESERVED' CHECK ("status" IN ('RESERVED', 'CONSUMED', 'RELEASED')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "EmissionCreditReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmissionCreditReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EmissionCreditReservation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PlanUsageCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmissionCreditReservation_requestKey_key" ON "EmissionCreditReservation"("requestKey");
CREATE INDEX "EmissionCreditReservation_userId_status_createdAt_idx" ON "EmissionCreditReservation"("userId", "status", "createdAt");
CREATE INDEX "EmissionCreditReservation_cycleId_status_idx" ON "EmissionCreditReservation"("cycleId", "status");
ALTER TABLE "EmissaoJob" ADD COLUMN "creditReservationId" TEXT;
ALTER TABLE "EmissaoJob" ADD COLUMN "ambiente" TEXT NOT NULL DEFAULT 'HOMOLOGACAO';
ALTER TABLE "EmissaoJob" ADD COLUMN "transmissionStartedAt" TIMESTAMP(3);
UPDATE "EmissaoJob" j SET "ambiente" = e."ambiente",
  "transmissionStartedAt" = CASE WHEN j."reservedDpsNumero" IS NOT NULL THEN COALESCE(j."startedAt", j."createdAt") ELSE NULL END
FROM "Empresa" e WHERE e."id" = j."empresaId";
CREATE UNIQUE INDEX "EmissaoJob_creditReservationId_key" ON "EmissaoJob"("creditReservationId");
ALTER TABLE "EmissaoJob" ADD CONSTRAINT "EmissaoJob_creditReservationId_fkey" FOREIGN KEY ("creditReservationId") REFERENCES "EmissionCreditReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Freeze observed legacy counters, without reallocating consumption across
-- customers or automatically refunding old jobs. Reconcile before production.
INSERT INTO "PlanUsageCycle" ("id", "historyId", "startsAt", "endsAt", "used")
SELECT 'legacy:' || h."id", h."id", COALESCE(h."cicloInicio", h."dataInicio"),
  CASE WHEN h."tipoContratado" IN ('PLANO', 'CUSTOM')
    THEN LEAST(COALESCE(h."cicloInicio", h."dataInicio") + INTERVAL '1 month', h."dataFim") ELSE h."dataFim" END,
  GREATEST(h."notasEmitidas", 0)
FROM "PlanHistory" h;
COMMIT;
