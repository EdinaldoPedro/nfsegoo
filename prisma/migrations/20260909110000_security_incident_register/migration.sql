CREATE TABLE "SecurityIncident" (
  "id" TEXT NOT NULL,
  "protocol" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DETECTADO',
  "summary" TEXT NOT NULL,
  "affectedData" TEXT,
  "affectedSystems" TEXT,
  "affectedSubjectsEstimate" INTEGER,
  "riskToSubjects" TEXT NOT NULL DEFAULT 'DESCONHECIDO',
  "riskAssessment" TEXT,
  "containmentActions" TEXT,
  "decisionRationale" TEXT,
  "detectedAt" TIMESTAMP(3) NOT NULL,
  "containedAt" TIMESTAMP(3),
  "regulatoryDeadlineAt" TIMESTAMP(3) NOT NULL,
  "notifiedAnpdAt" TIMESTAMP(3),
  "notifiedSubjectsAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "retainUntil" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityIncident_protocol_key" ON "SecurityIncident"("protocol");
CREATE INDEX "SecurityIncident_status_regulatoryDeadlineAt_idx" ON "SecurityIncident"("status", "regulatoryDeadlineAt");
CREATE INDEX "SecurityIncident_severity_detectedAt_idx" ON "SecurityIncident"("severity", "detectedAt");
CREATE INDEX "SecurityIncident_retainUntil_idx" ON "SecurityIncident"("retainUntil");

ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecurityIncident" ADD CONSTRAINT "SecurityIncident_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
