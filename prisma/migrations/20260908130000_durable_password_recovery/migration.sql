BEGIN;

CREATE TABLE "PasswordResetRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "deliveryFailedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetRequest_tokenHash_key" ON "PasswordResetRequest"("tokenHash");
CREATE INDEX "PasswordResetRequest_userId_createdAt_idx" ON "PasswordResetRequest"("userId", "createdAt");
CREATE INDEX "PasswordResetRequest_expiresAt_consumedAt_revokedAt_idx" ON "PasswordResetRequest"("expiresAt", "consumedAt", "revokedAt");

ALTER TABLE "PasswordResetRequest"
  ADD CONSTRAINT "PasswordResetRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Links issued by the legacy single-token flow cannot be proven delivered.
-- Invalidate them during the security migration instead of silently accepting
-- two incompatible recovery protocols.
UPDATE "User" SET "resetToken" = NULL, "resetExpires" = NULL
WHERE "resetToken" IS NOT NULL OR "resetExpires" IS NOT NULL;

COMMIT;
