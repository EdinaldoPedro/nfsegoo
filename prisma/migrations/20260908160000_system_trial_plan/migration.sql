BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Plan" WHERE "slug" = 'TRIAL') THEN
    IF EXISTS (SELECT 1 FROM "Plan" WHERE "id" = '00000000-0000-4000-8000-000000000001') THEN
      RAISE EXCEPTION 'Reserved TRIAL plan id is already in use';
    END IF;
    INSERT INTO "Plan" (
      "id", "name", "slug", "description", "priceMonthly", "priceYearly", "features",
      "active", "recommended", "createdAt", "updatedAt", "maxNotasMensal",
      "diasTeste", "privado", "maxClientes", "tipo"
    ) VALUES (
      '00000000-0000-4000-8000-000000000001', 'Período de Teste', 'TRIAL',
      '7 dias grátis para novos usuários', 0, 0,
      '["Emissão de Notas","Cadastro de Clientes","Suporte Básico"]',
      TRUE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 3, 7, FALSE, 3, 'PLANO'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Plan" WHERE "slug" = 'TRIAL' AND "active" = TRUE
      AND "tipo" = 'PLANO' AND "diasTeste" BETWEEN 1 AND 90
      AND "maxNotasMensal" >= 0 AND "maxClientes" >= 0
  ) THEN
    RAISE EXCEPTION 'Existing TRIAL plan is incompatible with secure signup';
  END IF;
END $$;

COMMIT;
