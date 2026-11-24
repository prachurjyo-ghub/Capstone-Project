-- CreateEnum
CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'RESTORED');

-- CreateEnum
CREATE TYPE "InventoryReservationEventType" AS ENUM ('RESERVED', 'RELEASED', 'CONSUMED', 'RESTORED');

-- CreateEnum
CREATE TYPE "OrderConversionStatus" AS ENUM ('ORDER_CREATED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "OrderCancellationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'INSPECTED');

-- CreateEnum
CREATE TYPE "UrgentEligibilityStatus" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'ELIGIBLE', 'UNAVAILABLE');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_SUPPLIER_CONFIRMATION';

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "estimatedWindowEnd" TIMESTAMP(3),
ADD COLUMN     "estimatedWindowStart" TIMESTAMP(3),
ADD COLUMN     "recipientSnapshot" JSONB;

-- AlterTable
ALTER TABLE "fulfillment_status_history" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "option_acceptances" ADD COLUMN     "allocationReleaseReason" TEXT,
ADD COLUMN     "allocationReleasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "acceptanceItemId" UUID,
ADD COLUMN     "alternativePartInfo" TEXT,
ADD COLUMN     "brand" TEXT,
ADD COLUMN     "compatibilityNotes" TEXT,
ADD COLUMN     "condition" "ProductCondition",
ADD COLUMN     "inventoryId" UUID,
ADD COLUMN     "isAlternative" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "partNumber" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "acceptanceId" UUID,
ADD COLUMN     "deliverySnapshot" JSONB,
ADD COLUMN     "estimatedWindowEnd" TIMESTAMP(3),
ADD COLUMN     "estimatedWindowStart" TIMESTAMP(3),
ADD COLUMN     "externalSourcingRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supplierAvailabilityConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "supplierAvailabilityConfirmedBy" UUID,
ADD COLUMN     "targetDeadlineAt" TIMESTAMP(3),
ADD COLUMN     "urgentEligibility" "UrgentEligibilityStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN     "urgentEligibilityBasis" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "order_conversion_attempts" (
    "id" UUID NOT NULL,
    "acceptanceId" UUID NOT NULL,
    "orderId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "status" "OrderConversionStatus" NOT NULL,
    "exceptionCode" TEXT,
    "exceptionNote" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_conversion_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "inventoryId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservation_events" (
    "id" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "eventType" "InventoryReservationEventType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_reservation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_cancellation_requests" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "OrderCancellationStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decisionReason" TEXT,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_cancellation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_failures" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "releaseReservations" BOOLEAN NOT NULL DEFAULT false,
    "reportedByUserId" UUID NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_returns" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "OrderReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decisionReason" TEXT,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "receivedByUserId" UUID,
    "receivedAt" TIMESTAMP(3),
    "inspectionNote" TEXT,
    "restocked" BOOLEAN,
    "inspectedAt" TIMESTAMP(3),
    "refundRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "urgent_fulfillment_history" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromEligibility" "UrgentEligibilityStatus",
    "toEligibility" "UrgentEligibilityStatus" NOT NULL,
    "basis" TEXT NOT NULL,
    "estimatedWindowStart" TIMESTAMP(3),
    "estimatedWindowEnd" TIMESTAMP(3),
    "targetDeadlineAt" TIMESTAMP(3),
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "urgent_fulfillment_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_conversion_attempts_acceptanceId_key" ON "order_conversion_attempts"("acceptanceId");

-- CreateIndex
CREATE UNIQUE INDEX "order_conversion_attempts_orderId_key" ON "order_conversion_attempts"("orderId");

-- CreateIndex
CREATE INDEX "order_conversion_attempts_status_attemptedAt_idx" ON "order_conversion_attempts"("status", "attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_orderItemId_key" ON "inventory_reservations"("orderItemId");

-- CreateIndex
CREATE INDEX "inventory_reservations_inventoryId_status_idx" ON "inventory_reservations"("inventoryId", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_businessId_status_idx" ON "inventory_reservations"("businessId", "status");

-- CreateIndex
CREATE INDEX "inventory_reservation_events_reservationId_createdAt_idx" ON "inventory_reservation_events"("reservationId", "createdAt");

-- CreateIndex
CREATE INDEX "order_cancellation_requests_orderId_status_idx" ON "order_cancellation_requests"("orderId", "status");

-- CreateIndex
CREATE INDEX "order_cancellation_requests_customerId_requestedAt_idx" ON "order_cancellation_requests"("customerId", "requestedAt");

-- CreateIndex
CREATE INDEX "order_failures_orderId_reportedAt_idx" ON "order_failures"("orderId", "reportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "order_returns_orderId_key" ON "order_returns"("orderId");

-- CreateIndex
CREATE INDEX "order_returns_customerId_requestedAt_idx" ON "order_returns"("customerId", "requestedAt");

-- CreateIndex
CREATE INDEX "urgent_fulfillment_history_orderId_createdAt_idx" ON "urgent_fulfillment_history"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_acceptanceItemId_key" ON "order_items"("acceptanceItemId");

-- CreateIndex
CREATE INDEX "order_items_inventoryId_idx" ON "order_items"("inventoryId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_acceptanceId_key" ON "orders"("acceptanceId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_acceptanceId_fkey" FOREIGN KEY ("acceptanceId") REFERENCES "option_acceptances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_acceptanceItemId_fkey" FOREIGN KEY ("acceptanceItemId") REFERENCES "option_acceptance_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "supplier_inventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_conversion_attempts" ADD CONSTRAINT "order_conversion_attempts_acceptanceId_fkey" FOREIGN KEY ("acceptanceId") REFERENCES "option_acceptances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_conversion_attempts" ADD CONSTRAINT "order_conversion_attempts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "supplier_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservation_events" ADD CONSTRAINT "inventory_reservation_events_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "inventory_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservation_events" ADD CONSTRAINT "inventory_reservation_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cancellation_requests" ADD CONSTRAINT "order_cancellation_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cancellation_requests" ADD CONSTRAINT "order_cancellation_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cancellation_requests" ADD CONSTRAINT "order_cancellation_requests_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_cancellation_requests" ADD CONSTRAINT "order_cancellation_requests_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_failures" ADD CONSTRAINT "order_failures_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_failures" ADD CONSTRAINT "order_failures_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urgent_fulfillment_history" ADD CONSTRAINT "urgent_fulfillment_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urgent_fulfillment_history" ADD CONSTRAINT "urgent_fulfillment_history_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Concurrency-safe public order numbers.
CREATE SEQUENCE "order_number_seq" START 1001;

-- Defensive accounting constraints supplement service validation.
ALTER TABLE "inventory_reservations"
  ADD CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("quantity" > 0);
