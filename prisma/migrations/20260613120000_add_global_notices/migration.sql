CREATE TABLE "GlobalNotice" (
  "id" TEXT NOT NULL,
  "titulo" TEXT NOT NULL,
  "mensagem" TEXT NOT NULL,
  "tipo" TEXT NOT NULL DEFAULT 'INFO',
  "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
  "publico" TEXT NOT NULL DEFAULT 'TODOS',
  "iniciaEm" TIMESTAMP(3),
  "terminaEm" TIMESTAMP(3),
  "linkLabel" TEXT,
  "linkHref" TEXT,
  "anexoNome" TEXT,
  "anexoBase64" TEXT,
  "criadoPorId" TEXT,
  "publicadoEm" TIMESTAMP(3),
  "arquivadoEm" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GlobalNotice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GlobalNotice_status_iniciaEm_terminaEm_idx" ON "GlobalNotice"("status", "iniciaEm", "terminaEm");
CREATE INDEX "GlobalNotice_publico_idx" ON "GlobalNotice"("publico");
