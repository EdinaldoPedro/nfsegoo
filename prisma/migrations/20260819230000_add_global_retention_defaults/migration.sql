-- O CNAE nacional define o comportamento padrão das retenções.
ALTER TABLE "GlobalCnae"
ADD COLUMN "modoRetencoes" TEXT NOT NULL DEFAULT 'SUGERIR';

-- Regras municipais criadas antes da herança explícita não devem bloquear o padrão nacional.
ALTER TABLE "TributacaoMunicipal"
ALTER COLUMN "modoRetencoes" SET DEFAULT 'HERDAR';

UPDATE "TributacaoMunicipal"
SET "modoRetencoes" = 'HERDAR'
WHERE "modoRetencoes" = 'SUGERIR'
  AND "retemCrsf" IS NULL
  AND "aliquotaPisRetencao" IS NULL
  AND "aliquotaCofinsRetencao" IS NULL
  AND "aliquotaCsllRetencao" IS NULL
  AND "valorMinimoRetencaoCrsf" IS NULL
  AND "retemIr" IS NULL
  AND "aliquotaIr" IS NULL
  AND "retemInss" IS NULL
  AND "aliquotaInss" IS NULL;

-- 4,65% é o total de PIS (0,65%) + COFINS (3%) + CSLL (1%), não a CSLL isolada.
UPDATE "GlobalCnae"
SET "aliquotaCsllRetencao" = 1.00,
    "aliquotaCrsf" = 4.65,
    "valorMinimoRetencaoCrsf" = CASE
      WHEN "valorMinimoRetencaoCrsf" IS NULL OR "valorMinimoRetencaoCrsf" = 10.00 THEN 10.01
      ELSE "valorMinimoRetencaoCrsf"
    END
WHERE "retemCrsf" = TRUE
  AND "aliquotaPisRetencao" = 0.65
  AND "aliquotaCofinsRetencao" = 3.00
  AND "aliquotaCsllRetencao" = 4.65;
