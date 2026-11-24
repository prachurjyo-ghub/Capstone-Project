-- Existing refresh sessions predate CSRF binding and session-family tracking.
-- Revoke them during the additive migration so no legacy token can be used.
ALTER TABLE "refresh_sessions"
ADD COLUMN "familyId" UUID,
ADD COLUMN "csrfTokenHash" TEXT;

UPDATE "refresh_sessions"
SET
  "familyId" = "id",
  "csrfTokenHash" = 'legacy-session-revoked',
  "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP);

ALTER TABLE "refresh_sessions"
ALTER COLUMN "familyId" SET NOT NULL,
ALTER COLUMN "csrfTokenHash" SET NOT NULL;

CREATE INDEX "refresh_sessions_familyId_revokedAt_idx"
ON "refresh_sessions"("familyId", "revokedAt");
