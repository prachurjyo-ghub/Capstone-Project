# Phase 4: financial records, invoices, settlements and operations

All amounts are BDT `Decimal(12,2)` values and API money fields are serialized as
two-decimal strings. These APIs record activity performed outside PartsArc. They do not
charge cards, move bank funds, issue automatic refunds or prove that a financial provider
settled a transfer.

## Financial policy

- Issued invoice and order price snapshots are immutable. An invoice contains customer line
  prices, delivery and priority charges, but never supplier cost or platform margin.
- Partial customer receipts are allowed. Overpayment is rejected; cumulative active receipts
  may not exceed the issued invoice total.
- A receipt balance is the sum of posted `CUSTOMER_PAYMENT` entries without a linked reversal.
- Approved and processed refunds both consume refund eligibility. Refund eligibility is
  `active customer receipts - approved/processed refunds`.
- Supplier payables become eligible only when an order is `COMPLETED`.
- Supplier outstanding is
  `original payable - recovery adjustments - active settlement allocations`.
- Payout allocations are atomic and cannot exceed payable outstanding. A settlement records
  a transfer performed externally and does not execute one.
- Posted entries are never edited or deleted by APIs. Corrections create one linked
  `REVERSAL` entry with a mandatory reason. External references are unique within the
  documented operation/business/method scope, and mutation idempotency keys are unique.
- A return after payout creates a supplier-recovery record. It does not claim the original
  external payout was reversed.
- Delivery and priority charges use the accepted order snapshot. No tax or deduction is
  added because none is configured. Calculated platform margin is commercial margin, not
  realized profit; realized cash depends on active receipts, refunds and payouts.
- Financial and fulfillment statuses are independent. Recording money cannot advance an
  order, and fulfillment transitions cannot mark an invoice paid.

## Admin finance API

ADMIN and SUPER_ADMIN only:

- `POST /api/v1/admin/finance/orders/:orderId/invoices` — issue once; optional `dueAt`.
- `POST /api/v1/admin/finance/orders/:orderId/payments` — record an external receipt with
  `amount`, `method`, `externalReference`, `occurredAt`, `idempotencyKey` and optional `note`.
- `POST /api/v1/admin/finance/orders/:orderId/refunds` — approve an eligible refund with
  `amount`, `reason` and `idempotencyKey`.
- `POST /api/v1/admin/finance/refunds/:id/complete` — record external refund completion.
- `POST /api/v1/admin/finance/orders/:orderId/payables` — recognize the completed-order
  supplier liability idempotently.
- `POST /api/v1/admin/finance/settlements` — record an external payout with `businessId`,
  one to 100 `{ payableId, amount }` allocations, method/reference/time and idempotency key.
- `POST /api/v1/admin/finance/transactions/:id/reversals` — append a linked correction.
- `POST /api/v1/admin/finance/invoices/:id/void` — void only an invoice with no active
  customer receipt; otherwise use refund/reversal records.
- `GET /api/v1/admin/finance/invoices`, `/transactions`, `/refunds`, `/settlements` — bounded
  lists. Transaction filters include type/status/order/business and `[from,to)` UTC instants.
- `GET /api/v1/admin/finance/supplier-overview` — paginated supplier payable/paid/outstanding.
- `GET /api/v1/admin/finance/invoices/:id` and `/pdf` — private invoice access.

Example local flow (replace IDs and bearer token; never commit credentials):

```bash
curl -X POST http://localhost:4000/api/v1/admin/finance/orders/ORDER_ID/invoices \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{}'

curl -X POST http://localhost:4000/api/v1/admin/finance/orders/ORDER_ID/payments \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"amount":"1000.00","method":"bank","externalReference":"LOCAL-RECEIPT-1","occurredAt":"2026-10-19T12:00:00Z","idempotencyKey":"local-payment-0001"}'

curl -X POST http://localhost:4000/api/v1/admin/finance/orders/ORDER_ID/payables \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN"
```

## Customer and supplier API

Customers can list/view their own invoices, download authorized PDFs and view customer-safe
receipt/refund/reversal history:

- `GET /api/v1/customers/me/finance/invoices`
- `GET /api/v1/customers/me/finance/invoices/:id`
- `GET /api/v1/customers/me/finance/invoices/:id/pdf`
- `GET /api/v1/customers/me/finance/history`

Active supplier members send their normal `x-business-id`; server membership validation is
authoritative:

- `GET /api/v1/supplier/finance/summary?from=&to=`
- `GET /api/v1/supplier/finance/transactions`
- `GET /api/v1/supplier/finance/statements/download?from=&to=`

Supplier responses exclude customer details, platform margin and other suppliers. Customer
responses exclude supplier costs, payout details and internal references.

## Invoice and statement documents

Documents are generated in memory from trusted text templates. They do not fetch remote URLs,
write public files or create sensitive temporary files. Issued invoices snapshot seller,
customer, delivery and line-item data. Development can use the clearly marked placeholder
seller identity; production issuance fails until operations configures a non-placeholder
identity.

## Admin operations API

- `GET /api/v1/admin/operations/dashboard?from=<UTC>&to=<UTC>&timezone=Asia/Dhaka`
- `GET /api/v1/admin/operations/queues?queue=requests|quotations|orders|deliveries|cancellations|returns|refunds`
- `GET /api/v1/admin/operations/audit-logs` with bounded pagination and filters.
- `GET|PUT /api/v1/admin/operations/configuration` for the invoice business identity only.
- `GET|POST /api/v1/admin/operations/cases` and
  `PATCH /api/v1/admin/operations/cases/:id` for assigned, audited exception/dispute history.

There is no general-purpose status override or arbitrary configuration endpoint. The admin
workflow remains API-only; no admin portal is claimed.

## Events and deployment limitations

Invoice, receipt, refund, payable, payout and reversal mutations enqueue audience-specific
events in the existing PostgreSQL outbox transaction. Notifications exclude amounts,
external references, margins and notes.

No local Redis or Docker executable was available during Phase 4. BullMQ was therefore not
verified against a real Redis server; fallback/outbox tests are not presented as proof of a
live worker. Production still requires Redis, a running worker, explicit notification
providers, durable attachment storage and complete non-placeholder business identity.

The customer invoice/history and supplier transaction/statement screens are connected.
Admin operations remain API-only. Advanced quotation UI and outstanding inventory UI gaps
from earlier phases remain outside Phase 4.
