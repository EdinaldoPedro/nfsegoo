ALTER TABLE "EmissaoJob" ADD COLUMN "fiscalSnapshotJson" TEXT;
ALTER TABLE "NotaFiscal" ADD COLUMN "fiscalSnapshotJson" TEXT;

ALTER TABLE "ConfiguracaoSistema"
  ADD COLUMN "ibsCbsPilotoAtivo" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ibsCbsMeiAtivo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ibsCbsSimplesAtivo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ibsCbsLucroPresumidoAtivo" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ibsCbsLucroRealAtivo" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "GlobalCnae"
  ADD COLUMN "aliquotaPisRetencao" DECIMAL(5,2),
  ADD COLUMN "aliquotaCofinsRetencao" DECIMAL(5,2),
  ADD COLUMN "aliquotaCsllRetencao" DECIMAL(5,2),
  ADD COLUMN "valorMinimoRetencaoCrsf" DECIMAL(10,2) DEFAULT 10.01,
  ADD COLUMN "aliquotaInss" DECIMAL(5,2),
  ADD COLUMN "calculaPisCofinsDevido" BOOLEAN,
  ADD COLUMN "aliquotaPisDevido" DECIMAL(5,2),
  ADD COLUMN "aliquotaCofinsDevido" DECIMAL(5,2),
  ADD COLUMN "cstPisCofins" TEXT DEFAULT '01',
  ADD COLUMN "aliquotaTotTribSN" DECIMAL(5,2) DEFAULT 6.00,
  ADD COLUMN "aliquotaTotTribFederal" DECIMAL(5,2),
  ADD COLUMN "habilitaIbsCbs" BOOLEAN,
  ADD COLUMN "inicioObrigatoriedadeIbsCbs" TIMESTAMP(3),
  ADD COLUMN "codigoIndicadorOperacao" TEXT,
  ADD COLUMN "cstIbsCbs" TEXT,
  ADD COLUMN "classeTribIbsCbs" TEXT,
  ADD COLUMN "fonteNormativa" TEXT,
  ADD COLUMN "inicioVigencia" TIMESTAMP(3),
  ADD COLUMN "fimVigencia" TIMESTAMP(3);

ALTER TABLE "TributacaoMunicipal"
  ADD COLUMN "exigeCodigoTributacaoMunicipal" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "nbsPadrao" TEXT,
  ADD COLUMN "ativo" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "prioridade" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inicioVigencia" TIMESTAMP(3),
  ADD COLUMN "fimVigencia" TIMESTAMP(3),
  ADD COLUMN "modoRetencoes" TEXT NOT NULL DEFAULT 'SUGERIR',
  ADD COLUMN "retemCrsf" BOOLEAN,
  ADD COLUMN "aliquotaPisRetencao" DECIMAL(5,2),
  ADD COLUMN "aliquotaCofinsRetencao" DECIMAL(5,2),
  ADD COLUMN "aliquotaCsllRetencao" DECIMAL(5,2),
  ADD COLUMN "valorMinimoRetencaoCrsf" DECIMAL(10,2),
  ADD COLUMN "retemIr" BOOLEAN,
  ADD COLUMN "aliquotaIr" DECIMAL(5,2),
  ADD COLUMN "retemInss" BOOLEAN,
  ADD COLUMN "aliquotaInss" DECIMAL(5,2),
  ADD COLUMN "calculaPisCofinsDevido" BOOLEAN,
  ADD COLUMN "aliquotaPisDevido" DECIMAL(5,2),
  ADD COLUMN "aliquotaCofinsDevido" DECIMAL(5,2),
  ADD COLUMN "habilitaIbsCbs" BOOLEAN,
  ADD COLUMN "inicioObrigatoriedadeIbsCbs" TIMESTAMP(3),
  ADD COLUMN "codigoIndicadorOperacao" TEXT,
  ADD COLUMN "cstIbsCbs" TEXT,
  ADD COLUMN "classeTribIbsCbs" TEXT,
  ADD COLUMN "finNfsePadrao" TEXT,
  ADD COLUMN "indFinalPadrao" TEXT,
  ADD COLUMN "indDestPadrao" TEXT,
  ADD COLUMN "versaoLayout" TEXT NOT NULL DEFAULT '1.01',
  ADD COLUMN "fonteNormativa" TEXT,
  ADD COLUMN "observacoesFiscal" TEXT;

CREATE INDEX "TributacaoMunicipal_codigoIbge_cnae_ativo_inicioVigencia_fimVigencia_idx"
  ON "TributacaoMunicipal"("codigoIbge", "cnae", "ativo", "inicioVigencia", "fimVigencia");
