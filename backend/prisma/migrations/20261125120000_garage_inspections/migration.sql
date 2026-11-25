-- CreateEnum
CREATE TYPE "GarageRole" AS ENUM ('OWNER', 'MECHANIC');

-- CreateEnum
CREATE TYPE "GarageJobStatus" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'DRAFT', 'SUBMITTED', 'SHARED', 'CLOSED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'GARAGE_USER';

-- CreateTable
CREATE TABLE "garages" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "terminatedAt" TIMESTAMP(3),
    "amount" INTEGER,
    "area" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "hours" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage_memberships" (
    "id" UUID NOT NULL,
    "garageId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "role" "GarageRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT NOT NULL DEFAULT '',
    "specialty" TEXT NOT NULL DEFAULT '',
    "photo" TEXT,

    CONSTRAINT "garage_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage_jobs" (
    "id" UUID NOT NULL,
    "garageId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "mechanicId" UUID,
    "vehicle" TEXT NOT NULL,
    "registration" TEXT NOT NULL DEFAULT '',
    "service" TEXT NOT NULL,
    "concern" TEXT NOT NULL DEFAULT '',
    "consentAt" TIMESTAMP(3),
    "status" "GarageJobStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "quotation" JSONB,
    "evidenceRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage_evidence" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage_shares" (
    "jobId" UUID NOT NULL,
    "report" JSONB NOT NULL,
    "quotation" JSONB,
    "evidenceIds" UUID[],
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "garage_shares_pkey" PRIMARY KEY ("jobId")
);

-- CreateTable
CREATE TABLE "garage_ledger_entries" (
    "id" UUID NOT NULL,
    "garageId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "date" TEXT NOT NULL,

    CONSTRAINT "garage_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "garages_slug_key" ON "garages"("slug");

-- CreateIndex
CREATE INDEX "garages_published_area_type_idx" ON "garages"("published", "area", "type");

-- CreateIndex
CREATE UNIQUE INDEX "garage_memberships_userId_key" ON "garage_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "garage_memberships_username_key" ON "garage_memberships"("username");

-- CreateIndex
CREATE INDEX "garage_memberships_garageId_role_active_idx" ON "garage_memberships"("garageId", "role", "active");

-- CreateIndex
CREATE INDEX "garage_jobs_garageId_createdAt_idx" ON "garage_jobs"("garageId", "createdAt");

-- CreateIndex
CREATE INDEX "garage_jobs_mechanicId_status_idx" ON "garage_jobs"("mechanicId", "status");

-- CreateIndex
CREATE INDEX "garage_jobs_customerId_idx" ON "garage_jobs"("customerId");

-- CreateIndex
CREATE INDEX "garage_evidence_jobId_idx" ON "garage_evidence"("jobId");

-- CreateIndex
CREATE INDEX "garage_ledger_entries_garageId_date_idx" ON "garage_ledger_entries"("garageId", "date");

-- AddForeignKey
ALTER TABLE "garage_memberships" ADD CONSTRAINT "garage_memberships_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_memberships" ADD CONSTRAINT "garage_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_jobs" ADD CONSTRAINT "garage_jobs_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_jobs" ADD CONSTRAINT "garage_jobs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_jobs" ADD CONSTRAINT "garage_jobs_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "garage_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_evidence" ADD CONSTRAINT "garage_evidence_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "garage_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_shares" ADD CONSTRAINT "garage_shares_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "garage_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_ledger_entries" ADD CONSTRAINT "garage_ledger_entries_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "garages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
