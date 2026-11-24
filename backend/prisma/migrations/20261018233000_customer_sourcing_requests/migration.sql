-- AUTOPRO Task 7: customer sourcing request snapshots, idempotency and attachments.

CREATE SEQUENCE "sourcing_request_number_seq"
  AS BIGINT
  START WITH 1000
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

ALTER TABLE "sourcing_requests"
  ADD COLUMN "vehicleSnapshot" JSONB,
  ADD COLUMN "deliverySnapshot" JSONB,
  ADD COLUMN "neededByAt" TIMESTAMP(3),
  ADD COLUMN "submissionKey" TEXT,
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "sourcing_requests"
  ADD CONSTRAINT "sourcing_requests_version_nonnegative" CHECK ("version" >= 0);

CREATE UNIQUE INDEX "sourcing_requests_customerId_submissionKey_key"
  ON "sourcing_requests" ("customerId", "submissionKey");

ALTER TABLE "sourcing_request_items"
  ADD COLUMN "categoryId" UUID;

ALTER TABLE "sourcing_request_items"
  ADD CONSTRAINT "sourcing_request_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "sourcing_request_items_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "part_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "sourcing_request_items_categoryId_idx"
  ON "sourcing_request_items" ("categoryId");

ALTER TABLE "request_attachments"
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "contentSha256" TEXT;

ALTER TABLE "request_attachments"
  ADD CONSTRAINT "request_attachments_byte_size_positive"
    CHECK ("byteSize" IS NULL OR "byteSize" > 0),
  ADD CONSTRAINT "request_attachments_dimensions_positive"
    CHECK (("width" IS NULL AND "height" IS NULL) OR ("width" > 0 AND "height" > 0));

CREATE UNIQUE INDEX "request_attachments_storageKey_key"
  ON "request_attachments" ("storageKey");
