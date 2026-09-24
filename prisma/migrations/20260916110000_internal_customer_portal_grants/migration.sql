ALTER TABLE "User"
  ADD COLUMN "customerPortalGrantedAt" TIMESTAMP(3),
  ADD COLUMN "customerPortalGrantedById" TEXT,
  ADD COLUMN "customerPortalRevokedAt" TIMESTAMP(3);

-- Historic internal users start blocked. ADMIN/MASTER retain their existing
-- customer-company behavior in application policy; this migration changes no
-- company ownership, subscriptions, invoices or fiscal documents.
