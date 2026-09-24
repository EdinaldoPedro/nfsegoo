BEGIN;

-- Pending sign-ups held reusable verification codes in clear text and did not
-- contain a versioned legal acceptance. They are not production accounts, so
-- invalidate them and require a fresh, provable confirmation after deployment.
DELETE FROM "PendingRegistration";
ALTER TABLE "PendingRegistration" RENAME COLUMN "verificationCode" TO "verificationCodeHash";
ALTER TABLE "PendingRegistration" ADD COLUMN "termsVersion" TEXT NOT NULL;
ALTER TABLE "PendingRegistration" ADD COLUMN "privacyVersion" TEXT NOT NULL;
ALTER TABLE "PendingRegistration" ADD COLUMN "acceptedAt" TIMESTAMP(3) NOT NULL;

CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "privacyVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalAcceptance_userId_termsVersion_privacyVersion_key"
  ON "LegalAcceptance"("userId", "termsVersion", "privacyVersion");
CREATE INDEX "LegalAcceptance_acceptedAt_idx" ON "LegalAcceptance"("acceptedAt");
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
