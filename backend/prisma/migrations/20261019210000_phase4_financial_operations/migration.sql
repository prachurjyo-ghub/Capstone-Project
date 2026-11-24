CREATE TYPE "SupplierPayableStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'RECOVERY_DUE');
CREATE TYPE "OperationalCaseType" AS ENUM ('ORDER_EXCEPTION', 'DELIVERY_EXCEPTION', 'CANCELLATION', 'RETURN', 'REFUND', 'DISPUTE', 'OTHER');
CREATE TYPE "OperationalCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED');

ALTER TYPE "TransactionType" ADD VALUE 'SUPPLIER_PAYOUT';
ALTER TYPE "TransactionType" ADD VALUE 'SUPPLIER_RECOVERY';
ALTER TYPE "TransactionType" ADD VALUE 'REVERSAL';

ALTER TABLE "invoices" ADD COLUMN "customerSnapshot" JSONB,
ADD COLUMN "deliverySnapshot" JSONB,
ADD COLUMN "issuedByUserId" UUID,
ADD COLUMN "sellerSnapshot" JSONB,
ADD COLUMN "voidReason" TEXT,
ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedByUserId" UUID;

ALTER TABLE "refunds" ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvedByUserId" UUID,
ADD COLUMN "externalReference" TEXT,
ADD COLUMN "externalReferenceKey" TEXT,
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "method" TEXT,
ADD COLUMN "processedByUserId" UUID;

ALTER TABLE "supplier_settlements" ADD COLUMN "externalReference" TEXT,
ADD COLUMN "externalReferenceKey" TEXT,
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "method" TEXT,
ADD COLUMN "occurredAt" TIMESTAMP(3),
ADD COLUMN "recordedByUserId" UUID,
ADD COLUMN "reference" TEXT;

ALTER TABLE "transactions" ADD COLUMN "businessId" UUID,
ADD COLUMN "externalReference" TEXT,
ADD COLUMN "externalReferenceKey" TEXT,
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "method" TEXT,
ADD COLUMN "occurredAt" TIMESTAMP(3),
ADD COLUMN "recordedByUserId" UUID,
ADD COLUMN "reversalOfId" UUID,
ADD COLUMN "safeNote" TEXT;

CREATE TABLE "supplier_payables" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "status" "SupplierPayableStatus" NOT NULL DEFAULT 'OPEN',
  "originalAmount" DECIMAL(12,2) NOT NULL,
  "recoveryAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "eligibleAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_payables_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settlement_allocations" (
  "id" UUID NOT NULL,
  "settlementId" UUID NOT NULL,
  "payableId" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settlement_allocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_recoveries" (
  "id" UUID NOT NULL,
  "payableId" UUID NOT NULL,
  "orderReturnId" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supplier_recoveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_business_config" (
  "id" UUID NOT NULL,
  "configKey" TEXT NOT NULL DEFAULT 'default',
  "legalName" TEXT NOT NULL,
  "tradingName" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "taxIdentifier" TEXT,
  "isPlaceholder" BOOLEAN NOT NULL DEFAULT true,
  "updatedByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_business_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "operational_cases" (
  "id" UUID NOT NULL,
  "caseNumber" TEXT NOT NULL,
  "type" "OperationalCaseType" NOT NULL,
  "status" "OperationalCaseStatus" NOT NULL DEFAULT 'OPEN',
  "orderId" UUID,
  "businessId" UUID,
  "assignedToUserId" UUID,
  "title" TEXT NOT NULL,
  "resolution" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "operational_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "operational_case_history" (
  "id" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "fromStatus" "OperationalCaseStatus",
  "toStatus" "OperationalCaseStatus" NOT NULL,
  "note" TEXT NOT NULL,
  "actorUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_case_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_payables_orderId_key" ON "supplier_payables"("orderId");
CREATE INDEX "supplier_payables_businessId_status_eligibleAt_idx" ON "supplier_payables"("businessId", "status", "eligibleAt");
CREATE INDEX "settlement_allocations_payableId_idx" ON "settlement_allocations"("payableId");
CREATE UNIQUE INDEX "settlement_allocations_settlementId_payableId_key" ON "settlement_allocations"("settlementId", "payableId");
CREATE UNIQUE INDEX "supplier_recoveries_orderReturnId_key" ON "supplier_recoveries"("orderReturnId");
CREATE INDEX "supplier_recoveries_payableId_idx" ON "supplier_recoveries"("payableId");
CREATE UNIQUE INDEX "platform_business_config_configKey_key" ON "platform_business_config"("configKey");
CREATE UNIQUE INDEX "operational_cases_caseNumber_key" ON "operational_cases"("caseNumber");
CREATE INDEX "operational_cases_status_type_createdAt_idx" ON "operational_cases"("status", "type", "createdAt");
CREATE INDEX "operational_cases_assignedToUserId_status_idx" ON "operational_cases"("assignedToUserId", "status");
CREATE INDEX "operational_case_history_caseId_createdAt_idx" ON "operational_case_history"("caseId", "createdAt");
CREATE UNIQUE INDEX "invoices_orderId_key" ON "invoices"("orderId");
CREATE UNIQUE INDEX "refunds_idempotencyKey_key" ON "refunds"("idempotencyKey");
CREATE UNIQUE INDEX "refunds_externalReferenceKey_key" ON "refunds"("externalReferenceKey");
CREATE UNIQUE INDEX "supplier_settlements_reference_key" ON "supplier_settlements"("reference");
CREATE UNIQUE INDEX "supplier_settlements_idempotencyKey_key" ON "supplier_settlements"("idempotencyKey");
CREATE UNIQUE INDEX "supplier_settlements_externalReferenceKey_key" ON "supplier_settlements"("externalReferenceKey");
CREATE UNIQUE INDEX "transactions_reversalOfId_key" ON "transactions"("reversalOfId");
CREATE UNIQUE INDEX "transactions_idempotencyKey_key" ON "transactions"("idempotencyKey");
CREATE UNIQUE INDEX "transactions_externalReferenceKey_key" ON "transactions"("externalReferenceKey");
CREATE INDEX "transactions_businessId_createdAt_idx" ON "transactions"("businessId", "createdAt");
CREATE INDEX "transactions_invoiceId_type_idx" ON "transactions"("invoiceId", "type");
CREATE INDEX "transactions_refundId_idx" ON "transactions"("refundId");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_settlements" ADD CONSTRAINT "supplier_settlements_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "supplier_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "supplier_payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_recoveries" ADD CONSTRAINT "supplier_recoveries_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "supplier_payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_recoveries" ADD CONSTRAINT "supplier_recoveries_orderReturnId_fkey" FOREIGN KEY ("orderReturnId") REFERENCES "order_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_processedByUserId_fkey" FOREIGN KEY ("processedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "platform_business_config" ADD CONSTRAINT "platform_business_config_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operational_cases" ADD CONSTRAINT "operational_cases_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "operational_case_history" ADD CONSTRAINT "operational_case_history_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "operational_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operational_case_history" ADD CONSTRAINT "operational_case_history_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
