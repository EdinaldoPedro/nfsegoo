-- O IRRF possui limite próprio e não deve reutilizar o mínimo agregado da CRSF.
ALTER TABLE "GlobalCnae"
ADD COLUMN "valorMinimoRetencaoIr" DECIMAL(10,2) DEFAULT 10.01;

ALTER TABLE "TributacaoMunicipal"
ADD COLUMN "valorMinimoRetencaoIr" DECIMAL(10,2);
