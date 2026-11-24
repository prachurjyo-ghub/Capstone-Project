-- Representative state immediately before supplier_listing_images existed.
-- Fixed UUIDs keep post-migration verification deterministic.
INSERT INTO "supplier_businesses" (
  "id", "legalName", "displayName", "status", "updatedAt"
) VALUES (
  '10000000-0000-4000-8000-000000000001',
  'Phase 3 Legacy Supplier Ltd',
  'Phase 3 Legacy Supplier',
  'ACTIVE',
  CURRENT_TIMESTAMP
);

INSERT INTO "part_categories" ("id", "name", "slug", "updatedAt")
VALUES (
  '20000000-0000-4000-8000-000000000001',
  'Phase 3 Filters',
  'phase-3-filters',
  CURRENT_TIMESTAMP
);

INSERT INTO "products" (
  "id", "catalogueCode", "name", "categoryId", "updatedAt"
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  'PHASE3-LEGACY-FILTER',
  'Phase 3 Legacy Filter',
  '20000000-0000-4000-8000-000000000001',
  CURRENT_TIMESTAMP
);

INSERT INTO "supplier_inventory" (
  "id", "businessId", "productId", "sku", "stockQuantity", "unitPrice",
  "availabilityStatus", "listingClassification", "publicationStatus",
  "moderationStatus", "isAvailable", "isActive", "updatedAt"
) VALUES
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'LEGACY-APPROVED', 5, 1250.00, 'IN_STOCK', 'NEW_GENUINE',
    'PUBLISHED', 'APPROVED', true, true, CURRENT_TIMESTAMP
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'LEGACY-UNREVIEWED', 5, 950.00, 'IN_STOCK', 'NEW_AFTERMARKET',
    'PUBLISHED', 'NOT_REVIEWED', true, true, CURRENT_TIMESTAMP
  );
