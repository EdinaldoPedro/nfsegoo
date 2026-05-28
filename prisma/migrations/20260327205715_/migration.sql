-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI', 'CONTADOR', 'COMUM');

-- CreateEnum
CREATE TYPE "StatusNota" AS ENUM ('RASCUNHO', 'PROCESSANDO', 'AUTORIZADA', 'ERRO', 'CANCELADA');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'COMUM',
    "cpf" TEXT,
    "telefone" TEXT,
    "plano" TEXT DEFAULT 'GRATUITO',
    "planoCiclo" TEXT NOT NULL DEFAULT 'MENSAL',
    "planoStatus" TEXT NOT NULL DEFAULT 'active',
    "planoExpiresAt" TIMESTAMP(3),
    "cargo" TEXT,
    "avatarUrl" TEXT,
    "resetToken" TEXT,
    "resetExpires" TIMESTAMP(3),
    "darkMode" BOOLEAN NOT NULL DEFAULT false,
    "idioma" TEXT NOT NULL DEFAULT 'pt-BR',
    "notificacoesEmail" BOOLEAN NOT NULL DEFAULT true,
    "ipOrigem" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "empresaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tempEmail" TEXT,
    "verificationCode" TEXT,
    "verificationExpires" TIMESTAMP(3),
    "limiteEmpresas" INTEGER NOT NULL DEFAULT 5,
    "tutorialStep" INTEGER NOT NULL DEFAULT 0,
    "creditosPlano" INTEGER NOT NULL DEFAULT 0,
    "creditosExtras" INTEGER NOT NULL DEFAULT 0,
    "dataRenovacaoCiclo" TIMESTAMP(3),
    "empresasAdicionais" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Empresa" (
    "id" TEXT NOT NULL,
    "documento" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL DEFAULT 'PRODUCAO',
    "cadastroCompleto" BOOLEAN NOT NULL DEFAULT false,
    "serieDPS" TEXT NOT NULL DEFAULT '900',
    "ultimoDPS" INTEGER NOT NULL DEFAULT 0,
    "email" TEXT,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "cep" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "codigoIbge" TEXT,
    "aliquotaPadrao" DECIMAL(5,2) DEFAULT 0.00,
    "issRetidoPadrao" BOOLEAN NOT NULL DEFAULT false,
    "tipoTributacaoPadrao" TEXT DEFAULT '1',
    "regimeEspecialTributacao" TEXT DEFAULT '0',
    "inscricaoMunicipal" TEXT,
    "regimeTributario" TEXT DEFAULT 'MEI',
    "certificadoA1" TEXT,
    "senhaCertificado" TEXT,
    "certificadoVencimento" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastApiCheck" TIMESTAMP(3),
    "donoFaturamentoId" TEXT,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'PJ',
    "documento" TEXT,
    "nome" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "inscricaoMunicipal" TEXT,
    "inscricaoEstadual" TEXT,
    "cep" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "pais" TEXT NOT NULL DEFAULT 'Brasil',
    "codigoIbge" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "moeda" TEXT DEFAULT 'BRL',
    "nif" TEXT,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VinculoCarteira" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "apelido" TEXT,
    "tags" TEXT,
    "observacoes" TEXT,
    "emailFinanceiro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VinculoCarteira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venda" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCliente" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "apelido" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cnae" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "codigoNbs" TEXT,
    "temRetencaoInss" BOOLEAN NOT NULL DEFAULT false,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "Cnae_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotaFiscal" (
    "id" TEXT NOT NULL,
    "vendaId" TEXT,
    "numero" INTEGER,
    "valor" DECIMAL(10,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "prestadorCnpj" TEXT NOT NULL,
    "tomadorCnpj" TEXT NOT NULL,
    "status" "StatusNota" NOT NULL DEFAULT 'RASCUNHO',
    "xmlBase64" TEXT,
    "pdfBase64" TEXT,
    "chaveAcesso" TEXT,
    "protocolo" TEXT,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "cnae" TEXT,
    "codigoServico" TEXT,
    "dataEmissao" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotaFiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracaoSistema" (
    "id" TEXT NOT NULL DEFAULT 'config',
    "modeloDpsJson" TEXT,
    "versaoApi" TEXT NOT NULL DEFAULT '1.00',
    "ambiente" TEXT NOT NULL DEFAULT 'PRODUCAO',
    "smtpHost" TEXT,
    "smtpPort" INTEGER DEFAULT 587,
    "smtpUser" TEXT,
    "smtpPass" TEXT,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "emailRemetente" TEXT,

    CONSTRAINT "ConfiguracaoSistema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalCnae" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "itemLc" TEXT,
    "codigoTributacaoNacional" TEXT,
    "aliquotaPadrao" DECIMAL(5,2),
    "codigoNbs" TEXT,
    "temRetencaoInss" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "aliquotaCrsf" DECIMAL(5,2),
    "aliquotaIr" DECIMAL(5,2),
    "retemCrsf" BOOLEAN NOT NULL DEFAULT false,
    "retemIr" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GlobalCnae_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TributacaoMunicipal" (
    "id" TEXT NOT NULL,
    "cnae" TEXT NOT NULL,
    "codigoIbge" TEXT NOT NULL,
    "codigoTributacaoMunicipal" TEXT NOT NULL,
    "descricaoServicoMunicipal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "aliquotaIss" DECIMAL(5,2),
    "exigeNbs" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TributacaoMunicipal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthly" DECIMAL(10,2) NOT NULL,
    "priceYearly" DECIMAL(10,2) NOT NULL,
    "features" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "maxNotasMensal" INTEGER NOT NULL DEFAULT 0,
    "diasTeste" INTEGER NOT NULL DEFAULT 0,
    "privado" BOOLEAN NOT NULL DEFAULT false,
    "maxClientes" INTEGER NOT NULL DEFAULT 0,
    "tipo" TEXT NOT NULL DEFAULT 'PLANO',

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "dataInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataFim" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "notasEmitidas" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" TEXT,
    "empresaId" TEXT,
    "vendaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "protocolo" SERIAL NOT NULL,
    "assunto" TEXT NOT NULL,
    "categoria" TEXT,
    "prioridade" TEXT NOT NULL DEFAULT 'MEDIA',
    "descricao" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "clientUnread" BOOLEAN NOT NULL DEFAULT false,
    "anexoBase64" TEXT,
    "anexoNome" TEXT,
    "catalogId" TEXT,
    "solicitanteId" TEXT NOT NULL,
    "atendenteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMensagem" (
    "id" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "anexos" TEXT,
    "interno" BOOLEAN NOT NULL DEFAULT false,
    "anexoBase64" TEXT,
    "anexoNome" TEXT,
    "ticketId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMensagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContadorVinculo" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "contadorId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContadorVinculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketCatalog" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "prioridade" TEXT NOT NULL DEFAULT 'MEDIA',
    "instrucoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MunicipioHomologado" (
    "id" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 2,
    "regime" TEXT NOT NULL DEFAULT 'SN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MunicipioHomologado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pedido" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planoSlug" TEXT NOT NULL,
    "ciclo" TEXT NOT NULL,
    "notasAdicionais" INTEGER NOT NULL DEFAULT 0,
    "valorPlano" DECIMAL(10,2) NOT NULL,
    "valorAdicionais" DECIMAL(10,2) NOT NULL,
    "valorTotal" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "formaPagamento" TEXT,
    "gatewayId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fatura" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planoId" TEXT,
    "descricao" TEXT NOT NULL,
    "valorTotal" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "metodo" TEXT NOT NULL DEFAULT 'PIX',
    "txid" TEXT,
    "qrCodePix" TEXT,
    "pagoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cupom" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipoDesconto" TEXT NOT NULL,
    "valorDesconto" DECIMAL(10,2) NOT NULL,
    "validade" TIMESTAMP(3),
    "limiteUsos" INTEGER,
    "vezesUsado" INTEGER NOT NULL DEFAULT 0,
    "aplicarEm" TEXT NOT NULL DEFAULT 'CARRINHO_TOTAL',
    "maxCiclos" INTEGER,
    "parceiroNome" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "planosValidos" TEXT,
    "apenasPrimeiraCompra" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Cupom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CupomLog" (
    "id" TEXT NOT NULL,
    "cupomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "faturaId" TEXT NOT NULL,
    "descontoAplicado" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CupomLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_cpf_key" ON "User"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "User_resetToken_key" ON "User"("resetToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_empresaId_key" ON "User"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_documento_key" ON "Empresa"("documento");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_documento_key" ON "Cliente"("documento");

-- CreateIndex
CREATE UNIQUE INDEX "VinculoCarteira_empresaId_clienteId_key" ON "VinculoCarteira"("empresaId", "clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCliente_userId_empresaId_key" ON "UserCliente"("userId", "empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalCnae_codigo_key" ON "GlobalCnae"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "TributacaoMunicipal_cnae_codigoIbge_codigoTributacaoMunicip_key" ON "TributacaoMunicipal"("cnae", "codigoIbge", "codigoTributacaoMunicipal");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ContadorVinculo_contadorId_empresaId_key" ON "ContadorVinculo"("contadorId", "empresaId");

-- CreateIndex
CREATE INDEX "Fatura_userId_idx" ON "Fatura"("userId");

-- CreateIndex
CREATE INDEX "Fatura_status_idx" ON "Fatura"("status");

-- CreateIndex
CREATE INDEX "Fatura_txid_idx" ON "Fatura"("txid");

-- CreateIndex
CREATE UNIQUE INDEX "Cupom_codigo_key" ON "Cupom"("codigo");

-- CreateIndex
CREATE INDEX "Cupom_codigo_idx" ON "Cupom"("codigo");

-- CreateIndex
CREATE INDEX "Cupom_ativo_idx" ON "Cupom"("ativo");

-- CreateIndex
CREATE INDEX "CupomLog_cupomId_idx" ON "CupomLog"("cupomId");

-- CreateIndex
CREATE INDEX "CupomLog_userId_idx" ON "CupomLog"("userId");

-- CreateIndex
CREATE INDEX "CupomLog_faturaId_idx" ON "CupomLog"("faturaId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_donoFaturamentoId_fkey" FOREIGN KEY ("donoFaturamentoId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinculoCarteira" ADD CONSTRAINT "VinculoCarteira_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinculoCarteira" ADD CONSTRAINT "VinculoCarteira_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCliente" ADD CONSTRAINT "UserCliente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCliente" ADD CONSTRAINT "UserCliente_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cnae" ADD CONSTRAINT "Cnae_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaFiscal" ADD CONSTRAINT "NotaFiscal_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaFiscal" ADD CONSTRAINT "NotaFiscal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaFiscal" ADD CONSTRAINT "NotaFiscal_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanHistory" ADD CONSTRAINT "PlanHistory_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanHistory" ADD CONSTRAINT "PlanHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemLog" ADD CONSTRAINT "SystemLog_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemLog" ADD CONSTRAINT "SystemLog_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_atendenteId_fkey" FOREIGN KEY ("atendenteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "TicketCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMensagem" ADD CONSTRAINT "TicketMensagem_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMensagem" ADD CONSTRAINT "TicketMensagem_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContadorVinculo" ADD CONSTRAINT "ContadorVinculo_contadorId_fkey" FOREIGN KEY ("contadorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContadorVinculo" ADD CONSTRAINT "ContadorVinculo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEvent" ADD CONSTRAINT "UserEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fatura" ADD CONSTRAINT "Fatura_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fatura" ADD CONSTRAINT "Fatura_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CupomLog" ADD CONSTRAINT "CupomLog_cupomId_fkey" FOREIGN KEY ("cupomId") REFERENCES "Cupom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CupomLog" ADD CONSTRAINT "CupomLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CupomLog" ADD CONSTRAINT "CupomLog_faturaId_fkey" FOREIGN KEY ("faturaId") REFERENCES "Fatura"("id") ON DELETE CASCADE ON UPDATE CASCADE;
