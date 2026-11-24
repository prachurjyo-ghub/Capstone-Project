ALTER TABLE "customer_addresses"
ADD COLUMN "recipientName" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "deliveryInstructions" TEXT,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "vehicles"
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "customer_addresses_customerId_isActive_idx"
ON "customer_addresses"("customerId", "isActive");

-- Prisma schema syntax cannot represent this partial uniqueness rule.
CREATE UNIQUE INDEX "customer_addresses_one_active_default_idx"
ON "customer_addresses"("customerId")
WHERE "isDefault" = true AND "isActive" = true AND "deletedAt" IS NULL;
