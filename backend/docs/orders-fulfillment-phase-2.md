# Phase 2: orders, reservations and fulfillment

All routes use the `/api/v1` prefix and the normal access-token/session checks. Supplier routes also require `x-business-id`; the backend derives and revalidates the active membership. Response and error envelopes follow the existing API convention.

## Endpoints

### ADMIN / SUPER_ADMIN

- `POST /admin/acceptances/:acceptanceId/orders` — convert an immutable acceptance. Body: `{ "idempotencyKey": "at-least-8-characters" }`.
- `GET /admin/orders?page=1&pageSize=20&status=CONFIRMED&urgent=true`
- `GET /admin/orders/:id`
- `POST /admin/orders/:id/transitions` — operations transitions to `PICKED_UP`, `IN_DELIVERY`, `DELIVERED` or `COMPLETED`. Optional courier, tracking, pickup-location and safe note fields are accepted.
- `POST /admin/orders/:id/cancellations/:cancellationId/decision` — `APPROVED` or `REJECTED` with a reason.
- `POST /admin/orders/:id/failures` — record a code/reason and explicitly choose whether unused active reservations are released.
- `POST /admin/orders/:id/returns/:returnId/decision`
- `POST /admin/orders/:id/returns/:returnId/receive`
- `POST /admin/orders/:id/returns/:returnId/inspect` — inspection explicitly chooses whether saleable inventory is restored and whether a refund is required.
- `POST /admin/orders/:id/urgent-eligibility` — record `PENDING`, `ELIGIBLE` or `UNAVAILABLE`, its basis, conditional estimate window and target deadline.

### Active supplier owner/staff

- `GET /supplier/fulfillment`
- `GET /supplier/fulfillment/:id`
- `POST /supplier/fulfillment/:id/availability` — required for any externally sourced line. Body: `{ "available": true, "note": "..." }`.
- `POST /supplier/fulfillment/:id/transitions` — `SUPPLIER_PREPARING`, then `READY_FOR_PICKUP`.

Both active owner and staff memberships may perform these operational actions. Exact customer addresses, phone numbers, platform margins and customer prices are excluded. Suppliers receive only city/area delivery context.

### Customer

- `GET /customers/me/orders`
- `GET /customers/me/orders/:id`
- `POST /customers/me/orders/:id/cancellations` — pre-pickup request with a reason.
- `POST /customers/me/orders/:id/returns` — delivered/completed order return request.

## Conversion and pricing

An acceptance maps to exactly one order because every Phase 1 option contains one supplier quotation revision. The unique `Order.acceptanceId`, an acceptance advisory lock and a public-number sequence make concurrent retries safe. A retry returns the existing order. Customer totals, supplier costs, margins, charges, selected alternatives and delivery data are copied from the immutable acceptance/quotation snapshot; conversion accepts no price fields. Quotation expiry after acceptance does not change the accepted snapshot.

Conversion first locks every referenced inventory row in UUID order and checks all quantities. Insufficient stock rolls back the entire order and every reservation, while an `OrderConversionAttempt` records a safe exception against the preserved acceptance. Inactive businesses or businesses without active members are ineligible.

## Reservation accounting

- Inventory-backed lines reserve `physical stock - existing reservations` during conversion.
- A multi-line order reserves entirely or not at all.
- `reservedQuantity` remains protected by stock adjustment, bulk update and CSV confirmation rules.
- Reservation release changes only reserved quantity; it never fabricates physical stock.
- Verified operations pickup consumes a reservation exactly once, reducing both physical and reserved quantity and writing the existing stock-adjustment ledger plus reservation history.
- There is no automatic reservation expiry.
- External lines have no invented inventory. Any external line puts the order in `PENDING_SUPPLIER_CONFIRMATION`; supplier confirmation moves it to `CONFIRMED`. Declining records a fulfillment failure and releases unused inventory reservations.

## State machine

Normal path:

`PENDING_SUPPLIER_CONFIRMATION` (mixed/external only) → `CONFIRMED` → `SUPPLIER_PREPARING` → `READY_FOR_PICKUP` → `PICKED_UP` → `IN_DELIVERY` → `DELIVERED` → `COMPLETED`.

Supplier members control confirmation, preparation and readiness. Admin operations controls pickup onward. Each change is row-locked and records actor/time/history atomically. Repeating the completed effect is idempotent; skipping states is rejected.

## Cancellation, failure and returns

Customers may request cancellation only before pickup. Admin approval releases active reservations exactly once, sets `CANCELLED`, and explicitly releases that acceptance allocation. Request item allocation is recalculated, but prior quotations/options are not silently reopened. Rejection preserves the order.

Failures do not automatically restore stock. Operations must explicitly release unused active reservations. Consumed stock remains consumed.

Returns can be requested after delivery/completion. Admin approval does not change inventory. Receipt is recorded first; only a subsequent inspection with `restock: true` restores consumed inventory and writes a stock ledger entry. `refundRequired` is informational for Phase 4; no refund is executed.

## Conditional urgent fulfillment

Urgent orders begin with eligibility `PENDING`. Operations must record an explicit service-area/supplier basis. `ELIGIBLE` requires future estimate bounds and a future target deadline. Deadline breach is calculated at read time with the injected clock using `targetDeadlineAt <= now`. `UNAVAILABLE` and `PENDING` make no delivery promise. The accepted priority charge is immutable; additional charges require a future customer-approved commercial agreement.

## Local operations example

```bash
curl -X POST http://localhost:4000/api/v1/admin/acceptances/ACCEPTANCE_UUID/orders \
  -H 'Authorization: Bearer ADMIN_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"idempotencyKey":"local-order-conversion-001"}'

curl -X POST http://localhost:4000/api/v1/admin/orders/ORDER_UUID/transitions \
  -H 'Authorization: Bearer ADMIN_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"toStatus":"PICKED_UP","courierName":"Manual courier","trackingReference":"LOCAL-101"}'
```

Admin operations are API-only. Customer and supplier apps expose their completed Phase 2 actions. Phase 1 supplier revision, withdrawal and clarification UI gaps remain tracked; their APIs are unchanged.

## Deliberate limitations

No payment capture/refund execution, live GPS, background SLA reminders, automatic reservation expiry, Redis, external courier, or messaging integration is included. Manual courier/reference data is informational. Aggregate supplier dashboard metrics remain demonstrative; the fulfillment list and recent order rows are live.
