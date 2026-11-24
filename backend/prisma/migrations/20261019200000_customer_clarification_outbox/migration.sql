CREATE OR REPLACE FUNCTION autopro_enqueue_customer_clarification_event() RETURNS trigger AS $$
DECLARE
  event_type TEXT;
  event_key TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_type := 'CUSTOMER_CLARIFICATION_ASKED';
    event_key := concat('customer-clarification-asked:', NEW.id::text);
  ELSIF OLD."repliedAt" IS NULL AND NEW."repliedAt" IS NOT NULL THEN
    event_type := 'CUSTOMER_CLARIFICATION_REPLIED';
    event_key := concat('customer-clarification-replied:', NEW.id::text);
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO "outbox_events" (
    "id", "eventType", "aggregateType", "aggregateId", "eventKey", payload,
    status, attempts, "maxAttempts", "availableAt", "createdAt", "updatedAt"
  ) VALUES (
    gen_random_uuid(), event_type, 'CUSTOMER_CLARIFICATION', NEW.id, event_key,
    '{}'::jsonb, 'PENDING', 0, 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) ON CONFLICT ("eventKey") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase3_customer_clarification_outbox
AFTER INSERT OR UPDATE ON "customer_option_clarifications"
FOR EACH ROW EXECUTE FUNCTION autopro_enqueue_customer_clarification_event();
