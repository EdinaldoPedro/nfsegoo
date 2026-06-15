ALTER TABLE "SystemLog"
ADD COLUMN "module" TEXT,
ADD COLUMN "traceId" TEXT,
ADD COLUMN "userId" TEXT,
ADD COLUMN "requestPath" TEXT,
ADD COLUMN "statusCode" INTEGER,
ADD COLUMN "durationMs" INTEGER,
ADD COLUMN "debugHint" TEXT;

CREATE INDEX "SystemLog_createdAt_idx" ON "SystemLog"("createdAt");
CREATE INDEX "SystemLog_level_idx" ON "SystemLog"("level");
CREATE INDEX "SystemLog_module_idx" ON "SystemLog"("module");
CREATE INDEX "SystemLog_traceId_idx" ON "SystemLog"("traceId");
CREATE INDEX "SystemLog_empresaId_idx" ON "SystemLog"("empresaId");
CREATE INDEX "SystemLog_vendaId_idx" ON "SystemLog"("vendaId");
