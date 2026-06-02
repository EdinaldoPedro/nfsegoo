ALTER TABLE "Empresa" ADD COLUMN "proprietarioUserId" TEXT;

UPDATE "Empresa" e
SET "proprietarioUserId" = u."id",
    "statusPropriedade" = 'PROPRIETARIA'
FROM "User" u
WHERE u."empresaId" = e."id"
  AND e."proprietarioUserId" IS NULL;

UPDATE "Empresa"
SET "proprietarioUserId" = "donoFaturamentoId",
    "statusPropriedade" = 'PROPRIETARIA'
WHERE "proprietarioUserId" IS NULL
  AND "donoFaturamentoId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ContadorVinculo" cv
    WHERE cv."empresaId" = "Empresa"."id"
      AND cv."status" = 'APROVADO'
      AND cv."arquivadoEm" IS NULL
  );

CREATE INDEX "Empresa_proprietarioUserId_idx" ON "Empresa"("proprietarioUserId");

ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_proprietarioUserId_fkey"
FOREIGN KEY ("proprietarioUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
