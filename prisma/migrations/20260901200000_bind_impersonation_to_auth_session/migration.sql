BEGIN;

ALTER TABLE "ImpersonationSession" ADD COLUMN "actorSessionId" TEXT;
CREATE INDEX "ImpersonationSession_actorSessionId_idx" ON "ImpersonationSession"("actorSessionId");
-- Legacy impersonations did not bind to an authenticated device and must not survive deployment.
UPDATE "ImpersonationSession" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "revokedAt" IS NULL;
COMMIT;
