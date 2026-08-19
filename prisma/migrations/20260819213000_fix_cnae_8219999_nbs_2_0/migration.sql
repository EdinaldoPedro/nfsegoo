-- Corrige o de-para confirmado pelo XML oficial autorizado do cenario MEI/PF.
-- NBS 1.1806.53.00: Servicos de preparacao de documentos (NBS 2.0).
UPDATE "GlobalCnae"
SET
  "codigoNbs" = '118065300',
  "fonteNormativa" = COALESCE("fonteNormativa", 'NBS 2.0 - MDIC/RFB')
WHERE "codigo" = '8219999'
  AND ("codigoNbs" IS NULL OR "codigoNbs" = '118054000');

UPDATE "Cnae"
SET "codigoNbs" = '118065300'
WHERE "codigo" = '8219999'
  AND "codigoNbs" = '118054000';

UPDATE "TributacaoMunicipal"
SET
  "nbsPadrao" = '118065300',
  "fonteNormativa" = COALESCE("fonteNormativa", 'NBS 2.0 - MDIC/RFB')
WHERE "cnae" = '8219999'
  AND "nbsPadrao" = '118054000';
