BEGIN;

ALTER TABLE "UserCliente" ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedBy" TEXT, ADD COLUMN "revocationReason" TEXT;
CREATE INDEX "UserCliente_empresaId_revokedAt_idx" ON "UserCliente"("empresaId", "revokedAt");

CREATE TABLE "CompanyOwnershipRequest" (
  "id" TEXT PRIMARY KEY, "empresaId" TEXT NOT NULL, "initiatorId" TEXT NOT NULL,
  "proposedOwnerId" TEXT NOT NULL, "previousOwnerId" TEXT, "previousPrimaryUserId" TEXT,
  "mode" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "termsVersion" TEXT NOT NULL,
  "ownershipSnapshotJson" TEXT NOT NULL, "snapshotHash" TEXT NOT NULL,
  "caseTicketId" TEXT NOT NULL, "evidenceMessageId" TEXT NOT NULL, "evidenceHash" TEXT NOT NULL,
  "justification" TEXT NOT NULL, "reviewerId" TEXT, "reviewEvidenceMessageId" TEXT, "reviewEvidenceHash" TEXT,
  "resolutionJustification" TEXT, "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "finishedAt" TIMESTAMP(3),
  CONSTRAINT "Ownership_mode_check" CHECK ("mode" IN ('TRANSFER', 'RECOVERY')),
  CONSTRAINT "Ownership_status_check" CHECK ("status" IN ('PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  CONSTRAINT "Ownership_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "Ownership_snapshot_hash_check" CHECK ("snapshotHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "Ownership_origin_check" CHECK (
    ("mode" = 'TRANSFER' AND "previousOwnerId" IS NOT NULL) OR
    ("mode" = 'RECOVERY' AND "previousOwnerId" IS NULL AND "previousPrimaryUserId" IS NULL)),
  CONSTRAINT "Ownership_resolution_check" CHECK (
    ("status" = 'PENDING' AND "finishedAt" IS NULL) OR ("status" <> 'PENDING' AND "finishedAt" IS NOT NULL)),
  CONSTRAINT "Ownership_completion_check" CHECK ("status" <> 'COMPLETED' OR
    ("reviewerId" IS NOT NULL AND "resolvedById" = "reviewerId" AND
      ("mode" <> 'RECOVERY' OR ("reviewerId" <> "initiatorId" AND "reviewEvidenceMessageId" IS NOT NULL
        AND "reviewEvidenceHash" IS NOT NULL AND "reviewEvidenceHash" ~ '^[a-f0-9]{64}$')))),
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("proposedOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("previousOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("previousPrimaryUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("caseTicketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- A rejected/expired proposal cannot keep the company permanently reserved.
CREATE UNIQUE INDEX "Ownership_one_pending_company" ON "CompanyOwnershipRequest"("empresaId") WHERE "status" = 'PENDING';
CREATE INDEX "CompanyOwnershipRequest_empresaId_status_createdAt_idx" ON "CompanyOwnershipRequest"("empresaId", "status", "createdAt");
CREATE INDEX "CompanyOwnershipRequest_proposedOwnerId_status_createdAt_idx" ON "CompanyOwnershipRequest"("proposedOwnerId", "status", "createdAt");
CREATE INDEX "CompanyOwnershipRequest_previousOwnerId_status_createdAt_idx" ON "CompanyOwnershipRequest"("previousOwnerId", "status", "createdAt");
CREATE INDEX "CompanyOwnershipRequest_previousPrimaryUserId_status_createdA_idx" ON "CompanyOwnershipRequest"("previousPrimaryUserId", "status", "createdAt");
CREATE INDEX "CompanyOwnershipRequest_status_expiresAt_idx" ON "CompanyOwnershipRequest"("status", "expiresAt");

CREATE TABLE "CompanyOwnershipConsent" (
  "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL CHECK ("sessionVersion" >= 0),
  "termsHash" TEXT NOT NULL CHECK ("termsHash" ~ '^[a-f0-9]{64}$'),
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("requestId") REFERENCES "CompanyOwnershipRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CompanyOwnershipConsent_requestId_userId_key" ON "CompanyOwnershipConsent"("requestId", "userId");
CREATE INDEX "CompanyOwnershipConsent_userId_idx" ON "CompanyOwnershipConsent"("userId");
COMMIT;
