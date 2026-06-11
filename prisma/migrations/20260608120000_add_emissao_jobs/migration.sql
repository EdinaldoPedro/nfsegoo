-- CreateTable
CREATE TABLE "EmissaoJob" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "vendaId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "billingUserId" TEXT,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "statusMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "partitionKey" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "reservedPlanHistoryId" TEXT,
    "reservedDpsNumero" INTEGER,
    "serieDPS" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "resultNotaId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmissaoJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmissaoJob_empresaId_idempotencyKey_key" ON "EmissaoJob"("empresaId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "EmissaoJob_empresaId_status_createdAt_idx" ON "EmissaoJob"("empresaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "EmissaoJob_partitionKey_status_nextAttemptAt_idx" ON "EmissaoJob"("partitionKey", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmissaoJob_vendaId_idx" ON "EmissaoJob"("vendaId");
