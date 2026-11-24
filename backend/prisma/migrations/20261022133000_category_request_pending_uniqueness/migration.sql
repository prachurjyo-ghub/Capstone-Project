-- Only one pending request for the same normalized category name is allowed per
-- supplier. Historical approved/rejected requests remain repeatable and immutable.
DROP INDEX "supplier_category_requests_businessId_normalizedName_status_key";

CREATE UNIQUE INDEX "supplier_category_requests_pending_name_key"
ON "supplier_category_requests"("businessId", "normalizedName")
WHERE "status" = 'PENDING';
