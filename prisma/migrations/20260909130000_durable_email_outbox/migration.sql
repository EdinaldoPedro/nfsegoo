CREATE TABLE "EmailOutbox" (
  "id" TEXT NOT NULL,
  "dedupKey" TEXT NOT NULL,
  "recipientHash" TEXT NOT NULL,
  "payloadEncrypted" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDENTE',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "providerMessageId" TEXT,
  "sentAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOutbox_dedupKey_key" ON "EmailOutbox"("dedupKey");
CREATE INDEX "EmailOutbox_status_nextAttemptAt_leaseUntil_idx" ON "EmailOutbox"("status", "nextAttemptAt", "leaseUntil");
CREATE INDEX "EmailOutbox_expiresAt_idx" ON "EmailOutbox"("expiresAt");
CREATE INDEX "EmailOutbox_recipientHash_createdAt_idx" ON "EmailOutbox"("recipientHash", "createdAt");
