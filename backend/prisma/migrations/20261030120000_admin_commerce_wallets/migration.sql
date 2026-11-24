-- Supplier listing classification, typed sourcing requests, global commission policy,
-- prepaid supplier-credit wallets, and immutable commission accounting.
-- Existing inventory/request/order rows are preserved and are not financially backfilled.

CREATE TYPE "SupplierListingClassification" AS ENUM ('NEW_GENUINE', 'NEW_AFTERMARKET', 'USED');
CREATE TYPE "ListingPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "ListingModerationStatus" AS ENUM ('NOT_REVIEWED', 'APPROVED', 'FLAGGED', 'REJECTED');
CREATE TYPE "SourcingRequestType" AS ENUM ('CUSTOM_SOURCING', 'FIXED_PRICE_PURCHASE', 'USED_PART_RFQ');
CREATE TYPE "CreditRequirementStatus" AS ENUM ('NOT_APPLICABLE', 'ELIGIBLE', 'AWAITING_CREDITS', 'RESERVED');
CREATE TYPE "SupplierWalletStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE "WalletTopUpStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "WalletEntryType" AS ENUM ('TOP_UP', 'CREDIT_RESERVATION', 'COMMISSION_SETTLEMENT', 'RESERVATION_RELEASE', 'ADJUSTMENT', 'REVERSAL');
CREATE TYPE "CommissionReservationStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED', 'REVERSED');

ALTER TABLE "supplier_inventory"
  ADD COLUMN "listingClassification" "SupplierListingClassification",
  ADD COLUMN "publicationStatus" "ListingPublicationStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "moderationStatus" "ListingModerationStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
  ADD COLUMN "moderatedByUserId" UUID,
  ADD COLUMN "moderatedAt" TIMESTAMP(3),
  ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "sourcing_requests"
  ADD COLUMN "requestType" "SourcingRequestType" NOT NULL DEFAULT 'CUSTOM_SOURCING',
  ADD COLUMN "listingId" UUID,
  ADD COLUMN "targetBusinessId" UUID,
  ADD COLUMN "creditStatus" "CreditRequirementStatus" NOT NULL DEFAULT 'NOT_APPLICABLE';

DROP INDEX IF EXISTS "supplier_inventory_businessId_productId_condition_key";
CREATE UNIQUE INDEX "supplier_inventory_businessId_productId_listingClassification_key"
  ON "supplier_inventory"("businessId", "productId", "listingClassification");
CREATE INDEX "sourcing_requests_requestType_status_createdAt_idx"
  ON "sourcing_requests"("requestType", "status", "createdAt");
CREATE INDEX "sourcing_requests_targetBusinessId_creditStatus_createdAt_idx"
  ON "sourcing_requests"("targetBusinessId", "creditStatus", "createdAt");
CREATE INDEX "sourcing_requests_listingId_idx" ON "sourcing_requests"("listingId");

CREATE TABLE "commission_policies" (
  "id" UUID NOT NULL,
  "rateBps" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_policies_rate_check" CHECK ("rateBps" >= 0 AND "rateBps" <= 10000)
);

CREATE UNIQUE INDEX "commission_policies_one_active"
  ON "commission_policies" ("isActive") WHERE "isActive" = true;
CREATE INDEX "commission_policies_isActive_effectiveFrom_idx"
  ON "commission_policies"("isActive", "effectiveFrom");

CREATE TABLE "supplier_wallets" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "status" "SupplierWalletStatus" NOT NULL DEFAULT 'ACTIVE',
  "availableCredit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "reservedCredit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_wallets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_wallets_balances_nonnegative" CHECK ("availableCredit" >= 0 AND "reservedCredit" >= 0),
  CONSTRAINT "supplier_wallets_version_nonnegative" CHECK ("version" >= 0)
);

CREATE UNIQUE INDEX "supplier_wallets_businessId_key" ON "supplier_wallets"("businessId");
CREATE INDEX "supplier_wallets_status_updatedAt_idx" ON "supplier_wallets"("status", "updatedAt");

CREATE TABLE "wallet_top_ups" (
  "id" UUID NOT NULL,
  "walletId" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "status" "WalletTopUpStatus" NOT NULL DEFAULT 'PENDING',
  "paymentMethod" TEXT NOT NULL,
  "externalReference" TEXT NOT NULL,
  "evidenceReference" TEXT,
  "supplierNote" TEXT,
  "decisionReason" TEXT,
  "requestedByUserId" UUID NOT NULL,
  "reviewedByUserId" UUID,
  "idempotencyKey" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_top_ups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_top_ups_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "wallet_top_ups_currency_bdt" CHECK ("currency" = 'BDT')
);

CREATE UNIQUE INDEX "wallet_top_ups_idempotencyKey_key" ON "wallet_top_ups"("idempotencyKey");
CREATE UNIQUE INDEX "wallet_top_ups_businessId_externalReference_key" ON "wallet_top_ups"("businessId", "externalReference");
CREATE INDEX "wallet_top_ups_status_requestedAt_idx" ON "wallet_top_ups"("status", "requestedAt");
CREATE INDEX "wallet_top_ups_businessId_requestedAt_idx" ON "wallet_top_ups"("businessId", "requestedAt");

CREATE TABLE "commission_reservations" (
  "id" UUID NOT NULL,
  "walletId" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "policyId" UUID NOT NULL,
  "status" "CommissionReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "eligibleAmount" DECIMAL(14,2) NOT NULL,
  "commissionRateBps" INTEGER NOT NULL,
  "commissionAmount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "idempotencyKey" TEXT NOT NULL,
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "reversedAt" TIMESTAMP(3),
  "settlementReference" TEXT,
  "releaseReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commission_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_reservations_amounts_check" CHECK ("eligibleAmount" >= 0 AND "commissionAmount" >= 0),
  CONSTRAINT "commission_reservations_rate_check" CHECK ("commissionRateBps" >= 0 AND "commissionRateBps" <= 10000),
  CONSTRAINT "commission_reservations_currency_bdt" CHECK ("currency" = 'BDT')
);

CREATE UNIQUE INDEX "commission_reservations_orderId_key" ON "commission_reservations"("orderId");
CREATE UNIQUE INDEX "commission_reservations_idempotencyKey_key" ON "commission_reservations"("idempotencyKey");
CREATE INDEX "commission_reservations_businessId_status_createdAt_idx" ON "commission_reservations"("businessId", "status", "createdAt");
CREATE INDEX "commission_reservations_status_createdAt_idx" ON "commission_reservations"("status", "createdAt");

CREATE TABLE "wallet_ledger_entries" (
  "id" UUID NOT NULL,
  "walletId" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "type" "WalletEntryType" NOT NULL,
  "availableDelta" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "reservedDelta" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "availableBalance" DECIMAL(14,2) NOT NULL,
  "reservedBalance" DECIMAL(14,2) NOT NULL,
  "topUpId" UUID,
  "reservationId" UUID,
  "orderId" UUID,
  "actorUserId" UUID,
  "reversalOfId" UUID,
  "idempotencyKey" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_ledger_balances_nonnegative" CHECK ("availableBalance" >= 0 AND "reservedBalance" >= 0),
  CONSTRAINT "wallet_ledger_nonzero_delta" CHECK ("availableDelta" <> 0 OR "reservedDelta" <> 0)
);

CREATE UNIQUE INDEX "wallet_ledger_entries_reversalOfId_key" ON "wallet_ledger_entries"("reversalOfId");
CREATE UNIQUE INDEX "wallet_ledger_entries_idempotencyKey_key" ON "wallet_ledger_entries"("idempotencyKey");
CREATE INDEX "wallet_ledger_entries_walletId_createdAt_idx" ON "wallet_ledger_entries"("walletId", "createdAt");
CREATE INDEX "wallet_ledger_entries_businessId_type_createdAt_idx" ON "wallet_ledger_entries"("businessId", "type", "createdAt");
CREATE INDEX "wallet_ledger_entries_orderId_idx" ON "wallet_ledger_entries"("orderId");

ALTER TABLE "supplier_inventory" ADD CONSTRAINT "supplier_inventory_moderatedByUserId_fkey"
  FOREIGN KEY ("moderatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sourcing_requests" ADD CONSTRAINT "sourcing_requests_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "supplier_inventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sourcing_requests" ADD CONSTRAINT "sourcing_requests_targetBusinessId_fkey"
  FOREIGN KEY ("targetBusinessId") REFERENCES "supplier_businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "commission_policies" ADD CONSTRAINT "commission_policies_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_wallets" ADD CONSTRAINT "supplier_wallets_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "supplier_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_top_ups" ADD CONSTRAINT "wallet_top_ups_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "commission_reservations" ADD CONSTRAINT "commission_reservations_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "supplier_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_reservations" ADD CONSTRAINT "commission_reservations_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_reservations" ADD CONSTRAINT "commission_reservations_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_reservations" ADD CONSTRAINT "commission_reservations_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "commission_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "supplier_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_topUpId_fkey"
  FOREIGN KEY ("topUpId") REFERENCES "wallet_top_ups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "commission_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_reversalOfId_fkey"
  FOREIGN KEY ("reversalOfId") REFERENCES "wallet_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Wallets are created lazily by the service. Historical inventory remains unclassified
-- and historical orders intentionally receive no synthetic commission obligation.
