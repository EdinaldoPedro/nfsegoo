ALTER TABLE "ConfiguracaoSistema"
ALTER COLUMN "manutencaoTitulo" SET DEFAULT 'Estamos realizando uma atualização';

UPDATE "ConfiguracaoSistema"
SET "manutencaoTitulo" = 'Estamos realizando uma atualização'
WHERE "manutencaoTitulo" = 'Estamos realizando uma atualizacao';
