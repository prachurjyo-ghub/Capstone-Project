-- AUTOPRO Task 8: supplier assignment history and focused clarifications.

CREATE TYPE "SupplierAssignmentEventType" AS ENUM (
  'ASSIGNED',
  'VIEWED',
  'SKIPPED',
  'EXPIRED',
  'WITHDRAWN',
  'DEADLINE_CHANGED',
  'CLARIFICATION_ASKED',
  'CLARIFICATION_REPLIED'
);

ALTER TABLE "supplier_request_assignments"
  ADD COLUMN "withdrawnAt" TIMESTAMP(3);

CREATE TABLE "supplier_assignment_history" (
  "id" UUID NOT NULL,
  "assignmentId" UUID NOT NULL,
  "eventType" "SupplierAssignmentEventType" NOT NULL,
  "fromStatus" "SupplierAssignmentStatus",
  "toStatus" "SupplierAssignmentStatus",
  "previousDeadlineAt" TIMESTAMP(3),
  "deadlineAt" TIMESTAMP(3),
  "reason" TEXT,
  "actorUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "supplier_assignment_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_clarifications" (
  "id" UUID NOT NULL,
  "assignmentId" UUID NOT NULL,
  "question" TEXT NOT NULL,
  "askedByUserId" UUID,
  "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reply" TEXT,
  "repliedByUserId" UUID,
  "repliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "supplier_clarifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "supplier_assignment_history_assignmentId_createdAt_idx"
  ON "supplier_assignment_history" ("assignmentId", "createdAt");

CREATE INDEX "supplier_clarifications_assignmentId_askedAt_idx"
  ON "supplier_clarifications" ("assignmentId", "askedAt");

ALTER TABLE "supplier_assignment_history"
  ADD CONSTRAINT "supplier_assignment_history_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "supplier_request_assignments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_assignment_history_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_clarifications"
  ADD CONSTRAINT "supplier_clarifications_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "supplier_request_assignments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_clarifications_askedByUserId_fkey"
    FOREIGN KEY ("askedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_clarifications_repliedByUserId_fkey"
    FOREIGN KEY ("repliedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
