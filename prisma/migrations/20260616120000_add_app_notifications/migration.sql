CREATE TABLE "AppNotification" (
  "id" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "empresaId" TEXT,
  "vendaId" TEXT,
  "notaId" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNREAD',
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "channel" TEXT NOT NULL DEFAULT 'IN_APP',
  "eventKey" TEXT NOT NULL,
  "payloadJson" TEXT,
  "readAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AppNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppNotification_recipientId_eventKey_key"
  ON "AppNotification"("recipientId", "eventKey");

CREATE INDEX "AppNotification_recipientId_status_createdAt_idx"
  ON "AppNotification"("recipientId", "status", "createdAt");

CREATE INDEX "AppNotification_empresaId_createdAt_idx"
  ON "AppNotification"("empresaId", "createdAt");

CREATE INDEX "AppNotification_vendaId_idx"
  ON "AppNotification"("vendaId");

CREATE INDEX "AppNotification_notaId_idx"
  ON "AppNotification"("notaId");

CREATE INDEX "AppNotification_type_idx"
  ON "AppNotification"("type");

ALTER TABLE "GlobalNotice"
  ADD COLUMN "notificarApp" BOOLEAN NOT NULL DEFAULT false;
