BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "tempEmail" IS NOT NULL GROUP BY "tempEmail" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate pending e-mails require manual review before migration';
  END IF;
END $$;
CREATE UNIQUE INDEX "User_tempEmail_key" ON "User"("tempEmail");
COMMIT;
