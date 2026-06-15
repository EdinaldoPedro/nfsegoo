CREATE TABLE "PedidoAnexo" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "conteudoBase64" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PedidoAnexo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PedidoAnexo_pedidoId_createdAt_idx" ON "PedidoAnexo"("pedidoId", "createdAt");
CREATE INDEX "PedidoAnexo_userId_createdAt_idx" ON "PedidoAnexo"("userId", "createdAt");

ALTER TABLE "PedidoAnexo" ADD CONSTRAINT "PedidoAnexo_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PedidoAnexo" ADD CONSTRAINT "PedidoAnexo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
