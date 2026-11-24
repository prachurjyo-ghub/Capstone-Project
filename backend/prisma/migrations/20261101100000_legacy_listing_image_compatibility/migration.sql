ALTER TABLE "supplier_inventory"
ADD COLUMN "legacyImageExempt" BOOLEAN NOT NULL DEFAULT false;

-- Preserve only listings that were already both published and explicitly
-- approved before the image requirement existed. New and unreviewed listings
-- remain subject to the normal image rule.
UPDATE "supplier_inventory" AS inventory
SET "legacyImageExempt" = true
WHERE inventory."publicationStatus" = 'PUBLISHED'
  AND inventory."moderationStatus" = 'APPROVED'
  AND NOT EXISTS (
    SELECT 1
    FROM "supplier_listing_images" AS image
    WHERE image."inventoryId" = inventory."id"
  );

CREATE INDEX "supplier_inventory_legacyImageExempt_publicationStatus_moderationStatus_idx"
ON "supplier_inventory"("legacyImageExempt", "publicationStatus", "moderationStatus");
