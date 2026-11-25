CREATE TABLE "garage_owner_recovery_requests" (
    "memberId" UUID NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "garage_owner_recovery_requests_pkey" PRIMARY KEY ("memberId")
);

CREATE INDEX "garage_owner_recovery_requests_requestedAt_idx" ON "garage_owner_recovery_requests"("requestedAt");

ALTER TABLE "garage_owner_recovery_requests" ADD CONSTRAINT "garage_owner_recovery_requests_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "garage_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
