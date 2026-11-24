-- The original generic trigger accessed typed OLD fields on INSERT records.
-- JSON access keeps the shared trigger safe across its heterogeneous tables.
CREATE OR REPLACE FUNCTION autopro_enqueue_domain_event() RETURNS trigger AS $$
DECLARE
  event_type TEXT;
  aggregate_type TEXT;
  aggregate_id UUID;
  event_key TEXT;
  old_row JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  new_row JSONB := to_jsonb(NEW);
BEGIN
  IF TG_TABLE_NAME = 'supplier_request_assignments' AND TG_OP = 'INSERT' THEN
    event_type := 'SUPPLIER_ASSIGNMENT_CREATED'; aggregate_type := 'SUPPLIER_ASSIGNMENT';
    aggregate_id := (new_row->>'id')::uuid; event_key := 'assignment:' || new_row->>'id';
  ELSIF TG_TABLE_NAME = 'supplier_clarifications' AND TG_OP = 'INSERT' THEN
    event_type := 'SUPPLIER_CLARIFICATION_ASKED'; aggregate_type := 'SUPPLIER_CLARIFICATION';
    aggregate_id := (new_row->>'id')::uuid; event_key := 'supplier-clarification-asked:' || new_row->>'id';
  ELSIF TG_TABLE_NAME = 'supplier_clarifications' AND TG_OP = 'UPDATE'
    AND old_row->>'repliedAt' IS NULL AND new_row->>'repliedAt' IS NOT NULL THEN
    event_type := 'SUPPLIER_CLARIFICATION_REPLIED'; aggregate_type := 'SUPPLIER_CLARIFICATION';
    aggregate_id := (new_row->>'id')::uuid; event_key := 'supplier-clarification-replied:' || new_row->>'id';
  ELSIF TG_TABLE_NAME = 'quotations' AND TG_OP = 'UPDATE'
    AND old_row->>'status' IS DISTINCT FROM new_row->>'status' AND new_row->>'status' = 'SUBMITTED' THEN
    event_type := 'QUOTATION_SUBMITTED'; aggregate_type := 'QUOTATION';
    aggregate_id := (new_row->>'id')::uuid;
    event_key := 'quotation-submitted:' || new_row->>'id' || ':' || new_row->>'revisionNumber';
  ELSIF TG_TABLE_NAME = 'sourcing_options' AND TG_OP = 'UPDATE'
    AND old_row->>'status' IS DISTINCT FROM new_row->>'status' AND new_row->>'status' = 'PUBLISHED' THEN
    event_type := 'SOURCING_OPTION_PUBLISHED'; aggregate_type := 'SOURCING_OPTION';
    aggregate_id := (new_row->>'id')::uuid;
    event_key := 'option-published:' || new_row->>'id' || ':' || new_row->>'revisionNumber';
  ELSIF TG_TABLE_NAME = 'option_acceptances' AND TG_OP = 'INSERT' THEN
    event_type := 'CUSTOMER_OPTION_ACCEPTED'; aggregate_type := 'OPTION_ACCEPTANCE';
    aggregate_id := (new_row->>'id')::uuid; event_key := 'acceptance:' || new_row->>'id';
  ELSIF TG_TABLE_NAME = 'orders' AND TG_OP = 'INSERT' THEN
    event_type := 'ORDER_CREATED'; aggregate_type := 'ORDER';
    aggregate_id := (new_row->>'id')::uuid; event_key := 'order-created:' || new_row->>'id';
  ELSIF TG_TABLE_NAME = 'fulfillment_status_history' AND TG_OP = 'INSERT' THEN
    event_type := 'ORDER_FULFILLMENT_CHANGED'; aggregate_type := 'ORDER';
    aggregate_id := (new_row->>'orderId')::uuid; event_key := 'fulfillment:' || new_row->>'id';
  ELSIF TG_TABLE_NAME = 'order_cancellation_requests' AND TG_OP = 'INSERT' THEN
    event_type := 'CANCELLATION_REQUESTED'; aggregate_type := 'ORDER';
    aggregate_id := (new_row->>'orderId')::uuid; event_key := 'cancellation:' || new_row->>'id';
  ELSIF TG_TABLE_NAME = 'order_cancellation_requests' AND TG_OP = 'UPDATE'
    AND old_row->>'status' IS DISTINCT FROM new_row->>'status' THEN
    event_type := 'ORDER_CANCELLATION_CHANGED'; aggregate_type := 'ORDER';
    aggregate_id := (new_row->>'orderId')::uuid;
    event_key := 'cancellation-status:' || new_row->>'id' || ':' || new_row->>'status';
  ELSIF TG_TABLE_NAME = 'order_returns' AND TG_OP = 'INSERT' THEN
    event_type := 'RETURN_REQUESTED'; aggregate_type := 'ORDER';
    aggregate_id := (new_row->>'orderId')::uuid; event_key := 'return:' || new_row->>'id';
  ELSIF TG_TABLE_NAME = 'order_returns' AND TG_OP = 'UPDATE'
    AND old_row->>'status' IS DISTINCT FROM new_row->>'status' THEN
    event_type := 'ORDER_RETURN_CHANGED'; aggregate_type := 'ORDER';
    aggregate_id := (new_row->>'orderId')::uuid;
    event_key := 'return-status:' || new_row->>'id' || ':' || new_row->>'status';
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
