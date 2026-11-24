# Admin commerce architecture and operations audit

## Scope and baseline

This audit uses `feat/admin-ux-simplification` as the baseline. The customer and supplier frontends are intentionally outside this phase; only backend contracts needed by those portals are added. Existing supplier, subscription, and catalogue Admin workspaces remain the design standard.

## Existing capability classification

| Area                        | Classification                                      | Existing authoritative capability                                                                           | Required change                                                                                                                                          |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                   | Existing but requiring extension                    | Operational KPIs from requests, orders, finance, cases, and subscriptions                                   | Add purchase-request, credit-block, top-up, and commission KPIs with filtered links                                                                      |
| Requests                    | Existing but requiring extension and simplification | `SourcingRequest`, items, attachments, status history, matching, supplier assignments                       | Add explicit request type and fixed-listing context; integrate quotation monitoring into one Requests workspace                                          |
| Quotations                  | Existing and reusable                               | `Quotation`, revisions, item snapshots, review state, clarifications, sourcing options, customer acceptance | Reuse for used-part RFQs; remove mandatory routine Admin review and redirect the separate Admin route                                                    |
| Orders                      | Existing and reusable                               | `Order`, immutable item/price snapshots, conversion, delivery, inventory reservations, state history        | Add commission snapshot/reservation state and consolidate cancellation/return queues into Orders                                                         |
| Cancellations and returns   | Existing but requiring consolidation                | Cancellation decisions, return receipt/inspection, refund and supplier-recovery records                     | Keep services and history; move Admin queue/actions into Orders                                                                                          |
| Finance                     | Existing but business-model-incompatible in places  | Customer invoices/payments, refunds, supplier payables/payout settlements, immutable transaction reversals  | Preserve historical records; add a separate prepaid-credit ledger and commission revenue views; do not create payouts for direct supplier/customer sales |
| Messages                    | Existing and reusable                               | Object-authorized conversations, participants, messages, attachments, unread state                          | Keep a concise cross-module Inbox and link conversations from request/order detail                                                                       |
| Cases                       | Existing and reusable but requiring simplification  | `OperationalCase` with linked order/supplier and immutable history                                          | Rename to Issues & Disputes, retain a central queue, and favor contextual creation                                                                       |
| Audit and system            | Security-critical and necessary                     | Audit logs, readiness, outbox processing/retry, reconciliation, business identity                           | Move to restricted Administration/Settings navigation and improve human-readable audit presentation                                                      |
| Suppliers                   | Existing and reusable                               | Business, members, owner, locations, categories, status and invitation/access controls                      | Preserve simplified UI; surface wallet summary only where useful                                                                                         |
| Subscriptions               | Existing and reusable                               | Plan, enrollment, invoice, payment/reversal, snapshots, status history                                      | No model rewrite; confirm independence from business status and prepaid commission wallet                                                                |
| Catalogue                   | Existing and reusable                               | Global category/brand/product references and part-number/compatibility children                             | Preserve simplified UI; add Admin listing inspection/moderation without duplicating products                                                             |
| Supplier inventory/listings | Existing but requiring extension                    | Supplier-specific product, SKU, price, stock, condition, publication flags and stock ledger                 | Add precise Genuine/Aftermarket/Used classification and moderation/publication state                                                                     |
| Notifications/jobs          | Existing and reusable                               | Notification records, immutable event keys, transactional outbox, retry worker                              | Add wallet, purchase-request, reservation, settlement, and release events                                                                                |
| Authentication/RBAC         | Security-critical and necessary                     | Roles, supplier membership resolution, object-scoped service queries, CSRF, session revocation              | Apply existing role and business-ownership guards to every new route                                                                                     |

## Authoritative model decisions

1. **Do not add another product, supplier, quotation, order, delivery, refund, conversation, or generic payment system.**
2. A supplier listing remains `SupplierInventory`; new fields classify and moderate it.
3. A fixed-price purchase request remains a `SourcingRequest` with one listing-backed item and an explicit request type. The existing request history, assignment, notification, conversation, and order relations remain available.
4. Used parts continue through the existing assignment → quotation revision → sourcing option → acceptance → order pipeline.
5. The existing `Order` remains the only fulfillment aggregate. A fixed-price request confirmation creates an order through a dedicated idempotent conversion path; accepted quotation orders continue using existing conversion.
6. The prepaid commission wallet is separate from subscription billing and from historical supplier payout/payable records.
7. Wallet balances are cached authoritative totals protected by PostgreSQL transactions and advisory locks; every mutation also writes an immutable ledger entry.
8. Commission policies are immutable versions. Orders/reservations snapshot eligible amount, basis-point rate, and calculated commission so later policy changes are never retroactive.
9. Wallet top-ups are prepaid liabilities until credits are settled as earned commission. Approval changes wallet balance; it does not create commission revenue.
10. Admin-authorized order completion is the initial trusted settlement trigger. Cancellation before settlement releases a reservation. Post-settlement corrections use compensating entries and retain the original settlement.

## Admin information architecture

### Before

- Overview: Dashboard
- Sourcing: Requests, Quotation review
- Fulfillment: Orders, Cancellations & returns
- Accounts: Customers, Suppliers, Subscriptions, Catalogue
- Operations: Finance, Messages, Cases & exceptions, Audit & system

### After

- Overview: Dashboard
- Commerce: Requests, Orders
- Accounts & catalogue: Customers, Suppliers, Subscriptions, Catalogue
- Operations: Finance, Inbox, Issues & disputes
- Administration: Settings & audit

Legacy `/quotations` and `/cancellations` routes remain as redirects to filtered Requests and Orders views. Deep detail routes remain available where they represent meaningful records.

## New backend capability boundaries

| Capability                            | Placement                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Listing classification and moderation | Extend inventory schema/service; Admin listing endpoints under catalogue/commerce operations                                |
| Commission policy versions            | New commerce-finance service and restricted Admin endpoints                                                                 |
| Supplier wallet and ledger            | New one-to-one business wallet plus immutable entries; supplier read APIs and Admin finance APIs                            |
| Top-up requests                       | New records with idempotent supplier submission and Admin approve/reject transaction                                        |
| Listing discovery eligibility         | Catalogue query joins the current policy and wallet available balance but never exposes the balance                         |
| Fixed-price purchase request          | New customer endpoint validates the published listing and creates an idempotent typed sourcing request                      |
| Supplier confirmation                 | Business-scoped endpoint validates request/listing/order state and atomically reserves commission before order confirmation |
| Quotation commission                  | Existing accepted-quotation order conversion; reserve on trusted supplier confirmation using order item snapshot totals     |
| Settlement/release/reversal           | Hook existing authorized order completion/cancellation paths into the wallet service                                        |

## Migration and rollout risks

- Existing inventory `condition` values cannot reliably distinguish genuine from aftermarket. The migration adds a nullable classification and does **not** guess historical data. Existing listings remain operational under legacy behavior until explicitly classified; new publication requires classification.
- Existing sourcing requests default to `CUSTOM_SOURCING`; no historical request is silently reclassified.
- Existing orders receive no fabricated commission reservation. Only new confirmations after feature enablement use wallet enforcement.
- Existing payout/payable tables are retained for historical compatibility but are not used for the new direct-payment commission model.
- Financial mutation routes require idempotency, exact `Decimal` arithmetic, advisory locking, unique order/top-up constraints, audit events, and authorization tests.
- Customer and supplier UI rollout is deferred. New APIs are additive and must not make incomplete customer-facing controls visible automatically.

## Implementation dependency order

The requested phases are retained with one technical adjustment: schema primitives, commission policy, wallet ledger, and reservation service are implemented before hooking purchase-request confirmation and order transitions. Admin navigation consolidation can proceed independently, while Finance and Dashboard integration follow the new APIs.
