CREATE TABLE "ImpersonationSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "reason" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImpersonationSession_tokenHash_key" ON "ImpersonationSession"("tokenHash");
CREATE INDEX "ImpersonationSession_actorUserId_expiresAt_idx" ON "ImpersonationSession"("actorUserId", "expiresAt");
CREATE INDEX "ImpersonationSession_targetUserId_expiresAt_idx" ON "ImpersonationSession"("targetUserId", "expiresAt");
CREATE INDEX "ImpersonationSession_expiresAt_revokedAt_idx" ON "ImpersonationSession"("expiresAt", "revokedAt");

ALTER TABLE "ImpersonationSession"
ADD CONSTRAINT "ImpersonationSession_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImpersonationSession"
ADD CONSTRAINT "ImpersonationSession_targetUserId_fkey"
FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
