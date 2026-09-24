BEGIN;

-- Additive commerce migration. Existing orders are preserved, but must not be
-- activated without a server-generated quote; cancel and recreate those orders.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COMERCIAL';

ALTER TABLE "Pedido"
  ADD COLUMN "cotacao" JSONB,
  ADD COLUMN "cotacaoHash" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "pendingKey" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "cupomId" TEXT,
  ADD COLUMN "cupomEstado" TEXT,
  ADD COLUMN "faturaId" TEXT,
  ADD COLUMN "referenciaPagamento" TEXT;
CREATE UNIQUE INDEX "Pedido_pendingKey_key" ON "Pedido"("pendingKey");
CREATE UNIQUE INDEX "Pedido_faturaId_key" ON "Pedido"("faturaId");
CREATE UNIQUE INDEX "Pedido_referenciaPagamento_key" ON "Pedido"("referenciaPagamento");
CREATE UNIQUE INDEX "Pedido_userId_idempotencyKey_key" ON "Pedido"("userId", "idempotencyKey");
CREATE INDEX "Pedido_userId_formaPagamento_status_createdAt_idx" ON "Pedido"("userId", "formaPagamento", "status", "createdAt");
CREATE INDEX "Pedido_cupomId_cupomEstado_expiresAt_idx" ON "Pedido"("cupomId", "cupomEstado", "expiresAt");
CREATE INDEX "Pedido_status_expiresAt_idx" ON "Pedido"("status", "expiresAt");
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_cupomId_fkey" FOREIGN KEY ("cupomId") REFERENCES "Cupom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_faturaId_fkey" FOREIGN KEY ("faturaId") REFERENCES "Fatura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlanHistory"
  ADD COLUMN "limiteNotasContratado" INTEGER,
  ADD COLUMN "limiteClientesContratado" INTEGER,
  ADD COLUMN "tipoContratado" TEXT,
  ADD COLUMN "nomeContratado" TEXT,
  ADD COLUMN "cicloInicio" TIMESTAMP(3),
  ADD COLUMN "pedidoId" TEXT;
-- Legacy limits are frozen at migration time; not claimed to reconstruct the
-- original commercial terms. Reconcile existing contracts before production.
UPDATE "PlanHistory" h SET
  "limiteNotasContratado" = p."maxNotasMensal",
  "limiteClientesContratado" = p."maxClientes",
  "tipoContratado" = p."tipo", "nomeContratado" = p."name",
  "cicloInicio" = CASE WHEN p."tipo" IN ('PLANO', 'CUSTOM')
    THEN GREATEST(h."dataInicio", date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) ELSE h."dataInicio" END
FROM "Plan" p WHERE h."planId" = p."id";
CREATE UNIQUE INDEX "PlanHistory_pedidoId_planId_key" ON "PlanHistory"("pedidoId", "planId");
CREATE INDEX "PlanHistory_userId_status_dataInicio_dataFim_idx" ON "PlanHistory"("userId", "status", "dataInicio", "dataFim");
ALTER TABLE "PlanHistory" ADD CONSTRAINT "PlanHistory_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Covers legacy registration / grants until they explicitly supply snapshots.
CREATE FUNCTION snapshot_plan_history() RETURNS trigger AS $$
DECLARE p "Plan"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT p FROM "Plan" WHERE "id" = NEW."planId";
  NEW."limiteNotasContratado" := COALESCE(NEW."limiteNotasContratado", p."maxNotasMensal");
  NEW."limiteClientesContratado" := COALESCE(NEW."limiteClientesContratado", p."maxClientes");
  NEW."tipoContratado" := COALESCE(NEW."tipoContratado", p."tipo");
  NEW."nomeContratado" := COALESCE(NEW."nomeContratado", p."name");
  NEW."cicloInicio" := COALESCE(NEW."cicloInicio", NEW."dataInicio");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PlanHistory_snapshot_before_insert" BEFORE INSERT ON "PlanHistory"
  FOR EACH ROW EXECUTE FUNCTION snapshot_plan_history();
COMMIT;
