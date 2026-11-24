-- Phase 3 communication, notification delivery and durable background outbox.
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'SKIPPED');

ALTER TABLE "conversations"
  ADD COLUMN "scopeKey" TEXT,
  ADD COLUMN "customerId" UUID,
  ADD COLUMN "businessId" UUID;
UPDATE "conversations" SET "scopeKey" = 'legacy:' || "id"::text WHERE "scopeKey" IS NULL;
ALTER TABLE "conversations" ALTER COLUMN "scopeKey" SET NOT NULL;

ALTER TABLE "conversation_participants" ADD COLUMN "lastReadMessageId" UUID;

ALTER TABLE "messages"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" UUID;

ALTER TABLE "message_attachments"
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "contentSha256" TEXT;

ALTER TABLE "notifications" ADD COLUMN "eventKey" TEXT;
UPDATE "notifications" SET "eventKey" = 'legacy:' || "id"::text WHERE "eventKey" IS NULL;
ALTER TABLE "notifications" ALTER COLUMN "eventKey" SET NOT NULL;

CREATE TABLE "notification_deliveries" (
  "id" UUID NOT NULL,
  "notificationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" UUID NOT NULL,
  "eventKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversations_scopeKey_key" ON "conversations"("scopeKey");
CREATE INDEX "conversations_customerId_lastMessageAt_idx" ON "conversations"("customerId", "lastMessageAt");
CREATE INDEX "conversations_businessId_lastMessageAt_idx" ON "conversations"("businessId", "lastMessageAt");
CREATE UNIQUE INDEX "messages_conversationId_senderUserId_idempotencyKey_key" ON "messages"("conversationId", "senderUserId", "idempotencyKey");
CREATE UNIQUE INDEX "messages_conversationId_sourceType_sourceId_key" ON "messages"("conversationId", "sourceType", "sourceId");
CREATE UNIQUE INDEX "notifications_userId_channel_eventKey_key" ON "notifications"("userId", "channel", "eventKey");
CREATE UNIQUE INDEX "notification_deliveries_notificationId_channel_key" ON "notification_deliveries"("notificationId", "channel");
CREATE INDEX "notification_deliveries_status_nextAttemptAt_idx" ON "notification_deliveries"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "outbox_events_eventKey_key" ON "outbox_events"("eventKey");
CREATE INDEX "outbox_events_status_availableAt_createdAt_idx" ON "outbox_events"("status", "availableAt", "createdAt");
CREATE INDEX "outbox_events_aggregateType_aggregateId_idx" ON "outbox_events"("aggregateType", "aggregateId");

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "supplier_businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain writes and their outbox records commit together. Payloads contain only IDs.
CREATE OR REPLACE FUNCTION autopro_enqueue_domain_event() RETURNS trigger AS $$
DECLARE
  event_type TEXT;
  aggregate_type TEXT;
  aggregate_id UUID;
  event_key TEXT;
BEGIN
  IF TG_TABLE_NAME = 'supplier_request_assignments' AND TG_OP = 'INSERT' THEN
    event_type := 'SUPPLIER_ASSIGNMENT_CREATED'; aggregate_type := 'SUPPLIER_ASSIGNMENT'; aggregate_id := NEW.id;
    event_key := 'assignment:' || NEW.id::text;
  ELSIF TG_TABLE_NAME = 'supplier_clarifications' AND TG_OP = 'INSERT' THEN
    event_type := 'SUPPLIER_CLARIFICATION_ASKED'; aggregate_type := 'SUPPLIER_CLARIFICATION'; aggregate_id := NEW.id;
    event_key := 'supplier-clarification-asked:' || NEW.id::text;
  ELSIF TG_TABLE_NAME = 'supplier_clarifications' AND TG_OP = 'UPDATE' AND OLD."repliedAt" IS NULL AND NEW."repliedAt" IS NOT NULL THEN
    event_type := 'SUPPLIER_CLARIFICATION_REPLIED'; aggregate_type := 'SUPPLIER_CLARIFICATION'; aggregate_id := NEW.id;
    event_key := 'supplier-clarification-replied:' || NEW.id::text;
  ELSIF TG_TABLE_NAME = 'quotations' AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'SUBMITTED' THEN
    event_type := 'QUOTATION_SUBMITTED'; aggregate_type := 'QUOTATION'; aggregate_id := NEW.id;
    event_key := 'quotation-submitted:' || NEW.id::text || ':' || NEW."revisionNumber"::text;
  ELSIF TG_TABLE_NAME = 'sourcing_options' AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'PUBLISHED' THEN
    event_type := 'SOURCING_OPTION_PUBLISHED'; aggregate_type := 'SOURCING_OPTION'; aggregate_id := NEW.id;
    event_key := 'option-published:' || NEW.id::text || ':' || NEW."revisionNumber"::text;
  ELSIF TG_TABLE_NAME = 'option_acceptances' AND TG_OP = 'INSERT' THEN
    event_type := 'CUSTOMER_OPTION_ACCEPTED'; aggregate_type := 'OPTION_ACCEPTANCE'; aggregate_id := NEW.id;
    event_key := 'acceptance:' || NEW.id::text;
  ELSIF TG_TABLE_NAME = 'orders' AND TG_OP = 'INSERT' THEN
    event_type := 'ORDER_CREATED'; aggregate_type := 'ORDER'; aggregate_id := NEW.id;
    event_key := 'order-created:' || NEW.id::text;
  ELSIF TG_TABLE_NAME = 'fulfillment_status_history' AND TG_OP = 'INSERT' THEN
    event_type := 'ORDER_FULFILLMENT_CHANGED'; aggregate_type := 'ORDER'; aggregate_id := NEW."orderId";
    event_key := 'fulfillment:' || NEW.id::text;
  ELSIF TG_TABLE_NAME = 'order_cancellation_requests' AND TG_OP = 'INSERT' THEN
    event_type := 'CANCELLATION_REQUESTED'; aggregate_type := 'ORDER'; aggregate_id := NEW."orderId";
    event_key := 'cancellation:' || NEW.id::text;
  ELSIF TG_TABLE_NAME = 'order_cancellation_requests' AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    event_type := 'ORDER_CANCELLATION_CHANGED'; aggregate_type := 'ORDER'; aggregate_id := NEW."orderId";
    event_key := 'cancellation-status:' || NEW.id::text || ':' || NEW.status::text;
  ELSIF TG_TABLE_NAME = 'order_returns' AND TG_OP = 'INSERT' THEN
    event_type := 'RETURN_REQUESTED'; aggregate_type := 'ORDER'; aggregate_id := NEW."orderId";
    event_key := 'return:' || NEW.id::text;
  ELSIF TG_TABLE_NAME = 'order_returns' AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    event_type := 'ORDER_RETURN_CHANGED'; aggregate_type := 'ORDER'; aggregate_id := NEW."orderId";
    event_key := 'return-status:' || NEW.id::text || ':' || NEW.status::text;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO "outbox_events" (
    "id", "eventType", "aggregateType", "aggregateId", "eventKey", payload,
    status, attempts, "maxAttempts", "availableAt", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid(), event_type, aggregate_type, aggregate_id, event_key,
    jsonb_build_object('sourceTable', TG_TABLE_NAME), 'PENDING', 0, 8,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) ON CONFLICT ("eventKey") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase3_assignment_outbox AFTER INSERT ON "supplier_request_assignments" FOR EACH ROW EXECUTE FUNCTION autopro_enqueue_domain_event();
CREATE TRIGGER phase3_supplier_clarification_outbox AFTER INSERT OR UPDATE ON "supplier_clarifications" FOR EACH ROW EXECUTE FUNCTION autopro_enqueue_domain_event();
CREATE TRIGGER phase3_quotation_outbox AFTER UPDATE ON "quotations" FOR EACH ROW EXECUTE FUNCTION autopro_enqueue_domain_event();
CREATE TRIGGER phase3_option_outbox AFTER UPDATE ON "sourcing_options" FOR EACH ROW EXECUTE FUNCTION autopro_enqueue_domain_event();
CREATE TRIGGER phase3_acceptance_outbox AFTER INSERT ON "option_acceptances" FOR EACH ROW EXECUTE FUNCTION autopro_enqueue_domain_event();
CREATE TRIGGER phase3_order_outbox AFTER INSERT ON "orders" FOR EACH ROW EXECUTE FUNCTION autopro_enqueue_domain_event();
CREATE TRIGGER phase3_fulfillment_outbox AFTER INSERT ON "fulfillment_status_history" FOR EACH ROW EXECUTE FUNCTION autopro_enqueue_domain_event();
CREATE TRIGGER phase3_cancellation_outbox AFTER INSERT OR UPDATE ON "order_cancellation_requests" FOR EACH ROW EXECUTE FUNCTION autopro_enqueue_domain_event();
CREATE TRIGGER phase3_return_outbox AFTER INSERT OR UPDATE ON "order_returns" FOR EACH ROW EXECUTE FUNCTION autopro_enqueue_domain_event();
