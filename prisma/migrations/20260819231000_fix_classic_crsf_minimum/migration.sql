-- A dispensa alcança valores retidos iguais ou inferiores a R$ 10,00.
-- Como o motor compara com >=, o primeiro centavo sujeito à retenção é R$ 10,01.
UPDATE "GlobalCnae"
SET "valorMinimoRetencaoCrsf" = 10.01
WHERE "retemCrsf" = TRUE
  AND "aliquotaCrsf" = 4.65
  AND "aliquotaPisRetencao" = 0.65
  AND "aliquotaCofinsRetencao" = 3.00
  AND "aliquotaCsllRetencao" = 1.00
  AND "valorMinimoRetencaoCrsf" = 10.00;
