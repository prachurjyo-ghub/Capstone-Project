-- AUTOPRO Phase 1: supplier quotations, published sourcing options and acceptance snapshots.

CREATE TYPE "ClarificationInitiator" AS ENUM ('SUPPLIER', 'ADMIN');
CREATE TYPE "SourcingOptionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'WITHDRAWN', 'REJECTED', 'ACCEPTED', 'INVALIDATED', 'EXPIRED');
ALTER TYPE "SupplierAssignmentEventType" ADD VALUE 'QUOTED';

CREATE SEQUENCE "quotation_number_seq" AS BIGINT START WITH 1000 INCREMENT BY 1 CACHE 1;
CREATE SEQUENCE "sourcing_option_number_seq" AS BIGINT START WITH 1000 INCREMENT BY 1 CACHE 1;

ALTER TABLE "quotations"
  ADD COLUMN "assignmentId" UUID,
  ADD COLUMN "submissionKey" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "supplier_request_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "quotations_version_nonnegative" CHECK ("version" >= 0);
CREATE UNIQUE INDEX "quotations_businessId_submissionKey_key" ON "quotations"("businessId", "submissionKey");
CREATE INDEX "quotations_assignmentId_status_idx" ON "quotations"("assignmentId", "status");

ALTER TABLE "quotation_items"
  ADD COLUMN "inventoryId" UUID,
  ADD COLUMN "alternativeToItemId" UUID,
  ADD COLUMN "partNumber" TEXT;
ALTER TABLE "quotation_items"
  ADD CONSTRAINT "quotation_items_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "supplier_inventory"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "quotation_items_alternativeToItemId_fkey" FOREIGN KEY ("alternativeToItemId") REFERENCES "quotation_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "quotation_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "quotation_items_supplier_prices_nonnegative" CHECK ("supplierUnitPrice" >= 0 AND "supplierLineTotal" >= 0);
CREATE INDEX "quotation_items_inventoryId_idx" ON "quotation_items"("inventoryId");
CREATE INDEX "quotation_items_alternativeToItemId_idx" ON "quotation_items"("alternativeToItemId");

ALTER TABLE "supplier_clarifications"
  ADD COLUMN "quotationId" UUID,
  ADD COLUMN "initiator" "ClarificationInitiator" NOT NULL DEFAULT 'SUPPLIER';
ALTER TABLE "supplier_clarifications"
  ADD CONSTRAINT "supplier_clarifications_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "supplier_clarifications_quotationId_askedAt_idx" ON "supplier_clarifications"("quotationId", "askedAt");

CREATE TABLE "sourcing_options" (
  "id" UUID NOT NULL, "optionNumber" TEXT NOT NULL, "requestId" UUID NOT NULL,
  "quotationId" UUID NOT NULL, "versionGroupId" UUID NOT NULL, "revisionNumber" INTEGER NOT NULL DEFAULT 1,
  "supersedesId" UUID, "status" "SourcingOptionStatus" NOT NULL DEFAULT 'DRAFT', "currency" TEXT NOT NULL DEFAULT 'BDT',
  "supplierSubtotal" DECIMAL(12,2) NOT NULL, "platformMargin" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "deliveryCharge" DECIMAL(12,2) NOT NULL DEFAULT 0, "priorityCharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "customerItemsTotal" DECIMAL(12,2) NOT NULL, "customerTotal" DECIMAL(12,2) NOT NULL,
  "preparationTimeMin" INTEGER, "deliveryEstimateText" TEXT, "compatibilityNotes" TEXT,
  "customerNotes" TEXT, "internalNotes" TEXT, "validUntil" TIMESTAMP(3) NOT NULL,
  "publishedAt" TIMESTAMP(3), "withdrawnAt" TIMESTAMP(3), "rejectedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3), "invalidationReason" TEXT, "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sourcing_options_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sourcing_options_money_nonnegative" CHECK ("supplierSubtotal" >= 0 AND "platformMargin" >= 0 AND "deliveryCharge" >= 0 AND "priorityCharge" >= 0 AND "customerItemsTotal" >= 0 AND "customerTotal" >= 0),
  CONSTRAINT "sourcing_options_version_nonnegative" CHECK ("version" >= 0)
);
CREATE UNIQUE INDEX "sourcing_options_optionNumber_key" ON "sourcing_options"("optionNumber");
CREATE UNIQUE INDEX "sourcing_options_versionGroupId_revisionNumber_key" ON "sourcing_options"("versionGroupId", "revisionNumber");
CREATE INDEX "sourcing_options_requestId_status_createdAt_idx" ON "sourcing_options"("requestId", "status", "createdAt");
CREATE INDEX "sourcing_options_quotationId_status_idx" ON "sourcing_options"("quotationId", "status");
CREATE INDEX "sourcing_options_validUntil_idx" ON "sourcing_options"("validUntil");

CREATE TABLE "sourcing_option_lines" (
  "id" UUID NOT NULL, "optionId" UUID NOT NULL, "requestItemId" UUID NOT NULL, "quotationItemId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL, "description" TEXT NOT NULL, "brand" TEXT, "partNumber" TEXT,
  "condition" "ProductCondition" NOT NULL, "quantity" INTEGER NOT NULL,
  "supplierUnitPrice" DECIMAL(12,2) NOT NULL, "supplierLineTotal" DECIMAL(12,2) NOT NULL,
  "customerUnitPrice" DECIMAL(12,2) NOT NULL, "customerLineTotal" DECIMAL(12,2) NOT NULL,
  "compatibilityNotes" TEXT, "alternativePartInfo" TEXT, "isAlternative" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sourcing_option_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sourcing_option_lines_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "sourcing_option_lines_prices_nonnegative" CHECK ("supplierUnitPrice" >= 0 AND "supplierLineTotal" >= 0 AND "customerUnitPrice" >= 0 AND "customerLineTotal" >= 0)
);
CREATE UNIQUE INDEX "sourcing_option_lines_optionId_requestItemId_key" ON "sourcing_option_lines"("optionId", "requestItemId");
CREATE UNIQUE INDEX "sourcing_option_lines_optionId_lineNumber_key" ON "sourcing_option_lines"("optionId", "lineNumber");
CREATE INDEX "sourcing_option_lines_quotationItemId_idx" ON "sourcing_option_lines"("quotationItemId");

CREATE TABLE "sourcing_option_history" (
  "id" UUID NOT NULL, "optionId" UUID NOT NULL, "fromStatus" "SourcingOptionStatus", "toStatus" "SourcingOptionStatus" NOT NULL,
  "reason" TEXT, "actorUserId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sourcing_option_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sourcing_option_history_optionId_createdAt_idx" ON "sourcing_option_history"("optionId", "createdAt");

CREATE TABLE "customer_option_clarifications" (
  "id" UUID NOT NULL, "optionId" UUID NOT NULL, "customerId" UUID NOT NULL, "question" TEXT NOT NULL,
  "askedByUserId" UUID, "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reply" TEXT,
  "repliedByUserId" UUID, "repliedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_option_clarifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_option_clarifications_optionId_askedAt_idx" ON "customer_option_clarifications"("optionId", "askedAt");
CREATE INDEX "customer_option_clarifications_customerId_askedAt_idx" ON "customer_option_clarifications"("customerId", "askedAt");

CREATE TABLE "option_acceptances" (
  "id" UUID NOT NULL, "optionId" UUID NOT NULL, "requestId" UUID NOT NULL, "customerId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "optionRevision" INTEGER NOT NULL, "currency" TEXT NOT NULL,
  "customerItemsTotal" DECIMAL(12,2) NOT NULL, "deliveryCharge" DECIMAL(12,2) NOT NULL,
  "priorityCharge" DECIMAL(12,2) NOT NULL, "customerTotal" DECIMAL(12,2) NOT NULL,
  "deliverySnapshot" JSONB NOT NULL, "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "option_acceptances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "option_acceptances_money_nonnegative" CHECK ("customerItemsTotal" >= 0 AND "deliveryCharge" >= 0 AND "priorityCharge" >= 0 AND "customerTotal" >= 0)
);
CREATE UNIQUE INDEX "option_acceptances_optionId_key" ON "option_acceptances"("optionId");
CREATE UNIQUE INDEX "option_acceptances_customerId_idempotencyKey_key" ON "option_acceptances"("customerId", "idempotencyKey");
CREATE INDEX "option_acceptances_requestId_acceptedAt_idx" ON "option_acceptances"("requestId", "acceptedAt");

CREATE TABLE "option_acceptance_items" (
  "id" UUID NOT NULL, "acceptanceId" UUID NOT NULL, "requestItemId" UUID NOT NULL, "optionLineId" UUID NOT NULL,
  "quotationItemId" UUID NOT NULL, "description" TEXT NOT NULL, "brand" TEXT, "partNumber" TEXT,
  "condition" "ProductCondition" NOT NULL, "quantity" INTEGER NOT NULL,
  "customerUnitPrice" DECIMAL(12,2) NOT NULL, "customerLineTotal" DECIMAL(12,2) NOT NULL,
  "compatibilityNotes" TEXT, "alternativePartInfo" TEXT, "isAlternative" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "option_acceptance_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "option_acceptance_items_quantity_positive" CHECK ("quantity" > 0)
);
CREATE UNIQUE INDEX "option_acceptance_items_acceptanceId_requestItemId_key" ON "option_acceptance_items"("acceptanceId", "requestItemId");
CREATE INDEX "option_acceptance_items_requestItemId_idx" ON "option_acceptance_items"("requestItemId");

ALTER TABLE "sourcing_options"
  ADD CONSTRAINT "sourcing_options_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "sourcing_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sourcing_options_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sourcing_options_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "sourcing_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sourcing_option_lines"
  ADD CONSTRAINT "sourcing_option_lines_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "sourcing_options"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sourcing_option_lines_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "sourcing_request_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sourcing_option_lines_quotationItemId_fkey" FOREIGN KEY ("quotationItemId") REFERENCES "quotation_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sourcing_option_history"
  ADD CONSTRAINT "sourcing_option_history_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "sourcing_options"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sourcing_option_history_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_option_clarifications"
  ADD CONSTRAINT "customer_option_clarifications_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "sourcing_options"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_option_clarifications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_option_clarifications_askedByUserId_fkey" FOREIGN KEY ("askedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "customer_option_clarifications_repliedByUserId_fkey" FOREIGN KEY ("repliedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "option_acceptances"
  ADD CONSTRAINT "option_acceptances_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "sourcing_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "option_acceptances_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "sourcing_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "option_acceptances_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "option_acceptance_items"
  ADD CONSTRAINT "option_acceptance_items_acceptanceId_fkey" FOREIGN KEY ("acceptanceId") REFERENCES "option_acceptances"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "option_acceptance_items_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "sourcing_request_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "option_acceptance_items_optionLineId_fkey" FOREIGN KEY ("optionLineId") REFERENCES "sourcing_option_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "option_acceptance_items_quotationItemId_fkey" FOREIGN KEY ("quotationItemId") REFERENCES "quotation_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
