-- AUTOPRO Task 6: catalogue and supplier inventory integrity.

CREATE TYPE "InventoryImportStatus" AS ENUM ('PREVIEWED', 'CONFIRMED', 'EXPIRED');

ALTER TABLE "supplier_inventory"
  ADD COLUMN "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "supplier_inventory"
  ADD CONSTRAINT "supplier_inventory_stock_nonnegative"
    CHECK ("stockQuantity" >= 0),
  ADD CONSTRAINT "supplier_inventory_reserved_nonnegative"
    CHECK ("reservedQuantity" >= 0),
  ADD CONSTRAINT "supplier_inventory_reserved_within_stock"
    CHECK ("reservedQuantity" <= "stockQuantity"),
  ADD CONSTRAINT "supplier_inventory_price_nonnegative"
    CHECK ("unitPrice" >= 0),
  ADD CONSTRAINT "supplier_inventory_minimum_stock_nonnegative"
    CHECK ("minimumStock" >= 0),
  ADD CONSTRAINT "supplier_inventory_preparation_time_nonnegative"
    CHECK ("preparationTimeMin" IS NULL OR "preparationTimeMin" >= 0),
  ADD CONSTRAINT "supplier_inventory_version_nonnegative"
    CHECK ("version" >= 0);

CREATE UNIQUE INDEX "product_numbers_one_primary_per_product"
  ON "product_numbers" ("productId")
  WHERE "isPrimary" = true;

CREATE TABLE "inventory_stock_adjustments" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "inventoryId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "quantityDelta" INTEGER NOT NULL,
  "previousQuantity" INTEGER NOT NULL,
  "resultingQuantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "inventory_stock_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_stock_adjustments_quantities_nonnegative"
    CHECK ("previousQuantity" >= 0 AND "resultingQuantity" >= 0),
  CONSTRAINT "inventory_stock_adjustments_delta_consistent"
    CHECK ("previousQuantity" + "quantityDelta" = "resultingQuantity")
);

CREATE UNIQUE INDEX "inventory_stock_adjustments_businessId_idempotencyKey_key"
  ON "inventory_stock_adjustments" ("businessId", "idempotencyKey");
CREATE INDEX "inventory_stock_adjustments_inventoryId_createdAt_idx"
  ON "inventory_stock_adjustments" ("inventoryId", "createdAt");
CREATE INDEX "inventory_stock_adjustments_businessId_createdAt_idx"
  ON "inventory_stock_adjustments" ("businessId", "createdAt");

ALTER TABLE "inventory_stock_adjustments"
  ADD CONSTRAINT "inventory_stock_adjustments_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_stock_adjustments_inventoryId_fkey"
    FOREIGN KEY ("inventoryId") REFERENCES "supplier_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_stock_adjustments_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "inventory_csv_previews" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "status" "InventoryImportStatus" NOT NULL DEFAULT 'PREVIEWED',
  "sourceHash" TEXT NOT NULL,
  "rows" JSONB NOT NULL,
  "summary" JSONB NOT NULL,
  "result" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "inventory_csv_previews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_csv_previews_businessId_status_createdAt_idx"
  ON "inventory_csv_previews" ("businessId", "status", "createdAt");
CREATE INDEX "inventory_csv_previews_expiresAt_idx"
  ON "inventory_csv_previews" ("expiresAt");

ALTER TABLE "inventory_csv_previews"
  ADD CONSTRAINT "inventory_csv_previews_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_csv_previews_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
