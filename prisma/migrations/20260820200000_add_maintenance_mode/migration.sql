ALTER TABLE "ConfiguracaoSistema"
ADD COLUMN "manutencaoAtiva" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "manutencaoTitulo" TEXT DEFAULT 'Estamos realizando uma atualizacao',
ADD COLUMN "manutencaoMensagem" TEXT,
ADD COLUMN "manutencaoPrevisao" TEXT,
ADD COLUMN "manutencaoAtualizadaEm" TIMESTAMP(3);
