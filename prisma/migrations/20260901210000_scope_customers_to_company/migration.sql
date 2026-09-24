-- Requires a verified backup before deployment. No customer, invoice or sale is deleted.
BEGIN;

ALTER TABLE "Cliente" ADD COLUMN "empresaId" TEXT;
DROP INDEX "Cliente_documento_key";

CREATE TABLE "ClienteTenantMigration" (
  "originalClienteId" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "clienteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClienteTenantMigration_pkey" PRIMARY KEY ("originalClienteId", "empresaId")
);
CREATE INDEX "ClienteTenantMigration_clienteId_idx" ON "ClienteTenantMigration"("clienteId");

CREATE FUNCTION pg_temp.rebind_customer_payload(payload TEXT, customer_id TEXT) RETURNS TEXT AS $$
BEGIN
  RETURN jsonb_set(payload::jsonb, '{clienteId}', to_jsonb(customer_id), false)::text;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN payload; -- Preserve malformed historical payloads for diagnostic review.
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  original "Cliente"%ROWTYPE;
  company_id TEXT;
  mapped_id TEXT;
  first_company BOOLEAN;
BEGIN
  FOR original IN SELECT * FROM "Cliente" ORDER BY "id" LOOP
    first_company := TRUE;
    FOR company_id IN
      SELECT ownership."empresaId" FROM (
        SELECT "empresaId" FROM "VinculoCarteira" WHERE "clienteId" = original."id"
        UNION SELECT "empresaId" FROM "Venda" WHERE "clienteId" = original."id"
        UNION SELECT "empresaId" FROM "NotaFiscal" WHERE "clienteId" = original."id"
        UNION SELECT "empresaId" FROM "NotaRascunho" WHERE "clienteId" = original."id"
        UNION SELECT "empresaId" FROM "EmissaoJob" WHERE "clienteId" = original."id"
      ) ownership JOIN "Empresa" ON "Empresa"."id" = ownership."empresaId"
      ORDER BY ownership."empresaId"
    LOOP
      IF first_company THEN
        mapped_id := original."id";
        UPDATE "Cliente" SET "empresaId" = company_id WHERE "id" = original."id";
        first_company := FALSE;
      ELSE
        mapped_id := gen_random_uuid()::text;
        INSERT INTO "Cliente"
        SELECT (jsonb_populate_record(NULL::"Cliente", to_jsonb(original) || jsonb_build_object('id', mapped_id, 'empresaId', company_id))).*;
      END IF;

      INSERT INTO "ClienteTenantMigration" ("originalClienteId", "empresaId", "clienteId")
      VALUES (original."id", company_id, mapped_id);

      UPDATE "VinculoCarteira" SET "clienteId" = mapped_id WHERE "clienteId" = original."id" AND "empresaId" = company_id;
      UPDATE "Venda" SET "clienteId" = mapped_id WHERE "clienteId" = original."id" AND "empresaId" = company_id;
      UPDATE "NotaFiscal" SET "clienteId" = mapped_id WHERE "clienteId" = original."id" AND "empresaId" = company_id;
      UPDATE "NotaRascunho" SET "clienteId" = mapped_id, "payloadJson" = pg_temp.rebind_customer_payload("payloadJson", mapped_id)
      WHERE "clienteId" = original."id" AND "empresaId" = company_id;
      UPDATE "EmissaoJob" SET "clienteId" = mapped_id, "payloadJson" = pg_temp.rebind_customer_payload("payloadJson", mapped_id)
      WHERE "clienteId" = original."id" AND "empresaId" = company_id;
    END LOOP;

    IF first_company THEN
      UPDATE "Cliente" SET "arquivadoEm" = COALESCE("arquivadoEm", CURRENT_TIMESTAMP),
        "motivoArquivamento" = COALESCE("motivoArquivamento", 'Cadastro legado sem empresa vinculada; preservado pela migracao multitenant.')
      WHERE "id" = original."id";
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX "Cliente_empresaId_documento_key" ON "Cliente"("empresaId", "documento");
CREATE UNIQUE INDEX "Cliente_id_empresaId_key" ON "Cliente"("id", "empresaId");
CREATE INDEX "Cliente_empresaId_arquivadoEm_createdAt_idx" ON "Cliente"("empresaId", "arquivadoEm", "createdAt");
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_active_requires_company" CHECK ("empresaId" IS NOT NULL OR "arquivadoEm" IS NOT NULL);

ALTER TABLE "VinculoCarteira" DROP CONSTRAINT "VinculoCarteira_clienteId_fkey";
ALTER TABLE "VinculoCarteira" ADD CONSTRAINT "VinculoCarteira_clienteId_empresaId_fkey" FOREIGN KEY ("clienteId", "empresaId") REFERENCES "Cliente"("id", "empresaId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Venda" DROP CONSTRAINT "Venda_clienteId_fkey";
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_clienteId_empresaId_fkey" FOREIGN KEY ("clienteId", "empresaId") REFERENCES "Cliente"("id", "empresaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotaFiscal" DROP CONSTRAINT "NotaFiscal_clienteId_fkey";
ALTER TABLE "NotaFiscal" ADD CONSTRAINT "NotaFiscal_clienteId_empresaId_fkey" FOREIGN KEY ("clienteId", "empresaId") REFERENCES "Cliente"("id", "empresaId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
