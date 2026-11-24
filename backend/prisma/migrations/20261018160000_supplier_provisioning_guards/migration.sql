-- Supplier invitees need a name without requiring a customer profile.
ALTER TABLE "users" ADD COLUMN "fullName" TEXT;

-- One current primary/owner membership per supplier business.
CREATE UNIQUE INDEX "supplier_users_one_current_primary_idx"
ON "supplier_users"("businessId")
WHERE "isPrimary" = true AND "leftAt" IS NULL;

-- Admins must resend/revoke instead of issuing parallel initial-owner links.
CREATE UNIQUE INDEX "account_invitations_one_pending_owner_idx"
ON "account_invitations"("businessId")
WHERE "invitationType" = 'SUPPLIER_OWNER' AND "status" = 'PENDING';
