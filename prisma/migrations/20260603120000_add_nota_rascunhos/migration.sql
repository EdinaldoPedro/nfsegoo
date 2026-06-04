-- CreateTable
CREATE TABLE "NotaRascunho" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT,
    "motivo" TEXT NOT NULL,
    "motivoTipo" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotaRascunho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotaRascunho_userId_empresaId_createdAt_idx" ON "NotaRascunho"("userId", "empresaId", "createdAt");
