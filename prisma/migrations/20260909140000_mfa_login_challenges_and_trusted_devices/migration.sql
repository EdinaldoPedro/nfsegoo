CREATE TABLE "MfaLoginChallenge" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailCodeHash" TEXT,
    "emailCodeExpiresAt" TIMESTAMP(3),
    "emailCodeSentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MfaLoginChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MfaTrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "userAgentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "MfaTrustedDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MfaLoginChallenge_tokenHash_key" ON "MfaLoginChallenge"("tokenHash");
CREATE INDEX "MfaLoginChallenge_userId_expiresAt_idx" ON "MfaLoginChallenge"("userId", "expiresAt");
CREATE INDEX "MfaLoginChallenge_expiresAt_consumedAt_idx" ON "MfaLoginChallenge"("expiresAt", "consumedAt");
CREATE UNIQUE INDEX "MfaTrustedDevice_tokenHash_key" ON "MfaTrustedDevice"("tokenHash");
CREATE INDEX "MfaTrustedDevice_userId_expiresAt_revokedAt_idx" ON "MfaTrustedDevice"("userId", "expiresAt", "revokedAt");
CREATE INDEX "MfaTrustedDevice_expiresAt_revokedAt_idx" ON "MfaTrustedDevice"("expiresAt", "revokedAt");
ALTER TABLE "MfaLoginChallenge" ADD CONSTRAINT "MfaLoginChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaTrustedDevice" ADD CONSTRAINT "MfaTrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
