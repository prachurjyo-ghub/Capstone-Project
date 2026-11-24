CREATE TABLE "supplier_listing_images" (
    "id" UUID NOT NULL,
    "inventoryId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_listing_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_listing_images_storageKey_key" ON "supplier_listing_images"("storageKey");
CREATE UNIQUE INDEX "supplier_listing_images_inventoryId_displayOrder_key" ON "supplier_listing_images"("inventoryId", "displayOrder");
CREATE INDEX "supplier_listing_images_inventoryId_isPrimary_idx" ON "supplier_listing_images"("inventoryId", "isPrimary");
ALTER TABLE "supplier_listing_images" ADD CONSTRAINT "supplier_listing_images_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "supplier_inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
