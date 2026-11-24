-- Supplier subscription entitlements, separate billing, temporary-password onboarding,
-- and supplier category governance. Existing active businesses receive a finite
-- review grace period; newly-created businesses do not.

CREATE TYPE "SupplierSubscriptionStatus" AS ENUM ('PENDING', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');
CREATE TYPE "SubscriptionPaymentKind" AS ENUM ('PAYMENT', 'REVERSAL');
CREATE TYPE "CategoryRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE SEQUENCE "subscription_invoice_number_seq" START 1;

ALTER TABLE "supplier_businesses" ADD COLUMN "subscriptionGraceEndsAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

UPDATE "supplier_businesses"
SET "subscriptionGraceEndsAt" = CURRENT_TIMESTAMP + INTERVAL '30 days'
WHERE "status" = 'ACTIVE';

CREATE TABLE "subscription_plans" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "durationMonths" INTEGER NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_plans_duration_check" CHECK ("durationMonths" IN (1, 4, 12)),
  CONSTRAINT "subscription_plans_price_check" CHECK ("price" >= 0),
  CONSTRAINT "subscription_plans_currency_check" CHECK ("currency" = 'BDT')
);

CREATE TABLE "supplier_subscriptions" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "planId" UUID,
  "status" "SupplierSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
  "planNameSnapshot" TEXT NOT NULL,
  "durationMonthsSnapshot" INTEGER NOT NULL,
  "priceSnapshot" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "suspendedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "complimentaryReason" TEXT,
  "statusReason" TEXT,
  "createdByUserId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_subscriptions_period_check" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "supplier_subscriptions_snapshot_check" CHECK ("durationMonthsSnapshot" > 0 AND "priceSnapshot" >= 0),
  CONSTRAINT "supplier_subscriptions_currency_check" CHECK ("currency" = 'BDT')
);

CREATE TABLE "subscription_invoices" (
  "id" UUID NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "businessId" UUID NOT NULL,
  "planId" UUID,
  "subscriptionId" UUID,
  "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
  "planNameSnapshot" TEXT NOT NULL,
  "durationMonthsSnapshot" INTEGER NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "periodStartsAt" TIMESTAMP(3) NOT NULL,
  "periodEndsAt" TIMESTAMP(3) NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "sellerSnapshot" JSONB NOT NULL,
  "supplierSnapshot" JSONB NOT NULL,
  "issuedByUserId" UUID NOT NULL,
  "voidedByUserId" UUID,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_invoices_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "subscription_invoices_period_check" CHECK ("periodEndsAt" > "periodStartsAt"),
  CONSTRAINT "subscription_invoices_currency_check" CHECK ("currency" = 'BDT')
);

CREATE TABLE "supplier_subscription_events" (
  "id" UUID NOT NULL,
  "subscriptionId" UUID NOT NULL,
  "fromStatus" "SupplierSubscriptionStatus",
  "toStatus" "SupplierSubscriptionStatus" NOT NULL,
  "reason" TEXT,
  "actorUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_subscription_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_payments" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "kind" "SubscriptionPaymentKind" NOT NULL DEFAULT 'PAYMENT',
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "method" TEXT NOT NULL,
  "externalReference" TEXT,
  "externalReferenceKey" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "safeNote" TEXT,
  "reversalOfId" UUID,
  "recordedByUserId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_payments_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "subscription_payments_currency_check" CHECK ("currency" = 'BDT')
);

CREATE TABLE "supplier_category_requests" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "proposedName" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "proposedParentId" UUID,
  "description" TEXT,
  "justification" TEXT NOT NULL,
  "status" "CategoryRequestStatus" NOT NULL DEFAULT 'PENDING',
  "approvedCategoryId" UUID,
  "decisionReason" TEXT,
  "createdByUserId" UUID NOT NULL,
  "reviewedByUserId" UUID,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_category_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_plans_name_key" ON "subscription_plans"("name");
CREATE INDEX "subscription_plans_isActive_durationMonths_idx" ON "subscription_plans"("isActive", "durationMonths");
CREATE UNIQUE INDEX "supplier_subscriptions_idempotencyKey_key" ON "supplier_subscriptions"("idempotencyKey");
CREATE INDEX "supplier_subscriptions_businessId_status_startsAt_endsAt_idx" ON "supplier_subscriptions"("businessId", "status", "startsAt", "endsAt");
CREATE INDEX "supplier_subscriptions_endsAt_status_idx" ON "supplier_subscriptions"("endsAt", "status");
CREATE INDEX "supplier_subscription_events_subscriptionId_createdAt_idx" ON "supplier_subscription_events"("subscriptionId", "createdAt");
CREATE UNIQUE INDEX "subscription_invoices_invoiceNumber_key" ON "subscription_invoices"("invoiceNumber");
CREATE UNIQUE INDEX "subscription_invoices_subscriptionId_key" ON "subscription_invoices"("subscriptionId");
CREATE UNIQUE INDEX "subscription_invoices_idempotencyKey_key" ON "subscription_invoices"("idempotencyKey");
CREATE INDEX "subscription_invoices_businessId_status_issuedAt_idx" ON "subscription_invoices"("businessId", "status", "issuedAt");
CREATE UNIQUE INDEX "subscription_payments_externalReferenceKey_key" ON "subscription_payments"("externalReferenceKey");
CREATE UNIQUE INDEX "subscription_payments_reversalOfId_key" ON "subscription_payments"("reversalOfId");
CREATE UNIQUE INDEX "subscription_payments_idempotencyKey_key" ON "subscription_payments"("idempotencyKey");
CREATE INDEX "subscription_payments_invoiceId_kind_createdAt_idx" ON "subscription_payments"("invoiceId", "kind", "createdAt");
CREATE INDEX "supplier_category_requests_status_createdAt_idx" ON "supplier_category_requests"("status", "createdAt");
CREATE INDEX "supplier_category_requests_businessId_status_createdAt_idx" ON "supplier_category_requests"("businessId", "status", "createdAt");
CREATE UNIQUE INDEX "supplier_category_requests_businessId_normalizedName_status_key" ON "supplier_category_requests"("businessId", "normalizedName", "status");

ALTER TABLE "supplier_subscriptions" ADD CONSTRAINT "supplier_subscriptions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_subscriptions" ADD CONSTRAINT "supplier_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_subscriptions" ADD CONSTRAINT "supplier_subscriptions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_subscription_events" ADD CONSTRAINT "supplier_subscription_events_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "supplier_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_subscription_events" ADD CONSTRAINT "supplier_subscription_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "supplier_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "subscription_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "subscription_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_category_requests" ADD CONSTRAINT "supplier_category_requests_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_category_requests" ADD CONSTRAINT "supplier_category_requests_proposedParentId_fkey" FOREIGN KEY ("proposedParentId") REFERENCES "part_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_category_requests" ADD CONSTRAINT "supplier_category_requests_approvedCategoryId_fkey" FOREIGN KEY ("approvedCategoryId") REFERENCES "part_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_category_requests" ADD CONSTRAINT "supplier_category_requests_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_category_requests" ADD CONSTRAINT "supplier_category_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
