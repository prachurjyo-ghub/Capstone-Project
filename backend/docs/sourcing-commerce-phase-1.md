# Complete sourcing workflow (Phase 1 / Tasks 9–11)

All paths are below `API_PREFIX` (normally `/api/v1`) and use the standard response envelope and request ID. Access tokens remain in frontend memory; the Task 3 refresh-cookie and CSRF contract is unchanged. Money is BDT and is serialized as a two-decimal string.

## Supplier quotations

Supplier routes require an active owner/staff membership and `X-Business-Id`. Owners and staff have the same quotation permission in Phase 1.

| Method  | Path                                                             | Purpose                                              |
| ------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `GET`   | `/supplier/quotations`                                           | Paginated list; optional `status`                    |
| `POST`  | `/supplier/quotations`                                           | Create a draft for an assignment                     |
| `GET`   | `/supplier/quotations/:id`                                       | Detail, lines, history, revisions and clarifications |
| `PATCH` | `/supplier/quotations/:id`                                       | Replace editable draft content                       |
| `POST`  | `/supplier/quotations/:id/submit`                                | Submit with `{ "idempotencyKey": "..." }`            |
| `POST`  | `/supplier/quotations/:id/revisions`                             | Create or return a pending draft revision            |
| `POST`  | `/supplier/quotations/:id/withdraw`                              | Withdraw with a reason                               |
| `POST`  | `/supplier/quotations/:id/clarifications/:clarificationId/reply` | Reply to operations                                  |

Draft create accepts `assignmentId`, `validUntil`, optional preparation/delivery/compatibility/supplier notes, and 1–100 items. Each item accepts `requestItemId`, optional supplier-owned `inventoryId`, optional catalogue `productId`, description, brand, part number, condition, positive quantity and nonnegative `supplierUnitPrice`. An alternative uses `alternativeToLineNumber` and must point to a primary line for the same request item. Primary lines alone form the supplier subtotal; alternatives are mutually exclusive candidates.

Submitted content is immutable. A revision is copied into a new draft with a unique revision number. The prior revision becomes `SUPERSEDED`, and its unaccepted options become nonactionable only when the new revision submits successfully. The revision deadline is the assignment response deadline; operations must extend that deadline before a supplier may submit later. Submission locks the quotation/assignment, is idempotent, updates assignment to `QUOTED`, and moves `MATCHING -> QUOTING` where applicable.

## Admin review and publication

Routes require `ADMIN` or `SUPER_ADMIN`. There is no admin frontend in this phase.

| Method | Path                                                       | Purpose                                      |
| ------ | ---------------------------------------------------------- | -------------------------------------------- |
| `GET`  | `/admin/requests/:requestId/quotation-comparison`          | Compare revisions and item coverage          |
| `GET`  | `/admin/quotations/:id`                                    | Review the complete supplier quotation       |
| `POST` | `/admin/quotations/:id/clarifications`                     | Ask supplier `{ "question": "..." }`         |
| `POST` | `/admin/quotations/:id/reject`                             | Reject with `{ "reason": "..." }`            |
| `POST` | `/admin/requests/:requestId/options`                       | Prepare a customer option draft              |
| `GET`  | `/admin/options/:id`                                       | Review internal and customer snapshot fields |
| `POST` | `/admin/options/:id/publish`                               | Publish with `{ "expectedVersion": 0 }`      |
| `POST` | `/admin/options/:id/withdraw`                              | Withdraw with a reason                       |
| `POST` | `/admin/options/:id/clarifications/:clarificationId/reply` | Reply to customer                            |

Prepare example (obtain an admin access token through normal login; never put admin credentials in a frontend):

```json
{
  "quotationId": "submitted-quotation-uuid",
  "quotationItemIds": ["one-selected-offer-per-request-item-uuid"],
  "platformMargin": "250.00",
  "deliveryCharge": "120.00",
  "priorityCharge": "0.00",
  "validUntil": "2026-10-20T12:00:00.000Z",
  "customerNotes": "Compatibility requires confirmation before installation"
}
```

An option selects exactly one primary or alternative line per covered request item and never performs multi-supplier bundle optimization. Its immutable snapshot records the quotation revision, lines, quantities, supplier and customer amounts, charges, compatibility text and deadline. A pricing change requires `supersedesOptionId`; publishing the new version invalidates the prior actionable version.

Amounts use PostgreSQL `Decimal(12,2)` and `ROUND_HALF_UP`. `customerItemsTotal = supplierSubtotal + platformMargin`; margin is allocated proportionally, with the final line absorbing the rounding remainder. `customerTotal = customerItemsTotal + deliveryCharge + priorityCharge`. Negative charges, duplicate selections and client totals are rejected. Customers never receive supplier subtotal, margin, supplier identity/contact or internal notes.

## Customer options and acceptance

| Method | Path                                        | Purpose                                     |
| ------ | ------------------------------------------- | ------------------------------------------- |
| `GET`  | `/customers/me/requests/:requestId/options` | List non-draft options for an owned request |
| `GET`  | `/customers/me/options/:id`                 | Customer-safe immutable option snapshot     |
| `POST` | `/customers/me/options/:id/clarifications`  | Ask operations a question                   |
| `POST` | `/customers/me/options/:id/reject`          | Reject with a reason                        |
| `POST` | `/customers/me/options/:id/accept`          | Accept an actionable option                 |

Acceptance requires an `idempotencyKey`, `expectedVersion`, and exactly one owned saved `deliveryAddressId` or complete `manualDelivery`. The transaction revalidates ownership, option version, `now < validUntil`, quotation validity/status, active supplier business and membership, and request state. The exact deadline boundary is expired.

Acceptance creates immutable item, price, selected-alternative and delivery snapshots. Accepted quantities are aggregated per request item under a request-row lock and cannot exceed requested quantities. Conflicting published options covering an accepted item are invalidated; nonconflicting partial-coverage options remain. The request becomes `ACCEPTED` only after every item quantity is covered, otherwise it remains `AWAITING_CUSTOMER`. This is Phase 2 input—not a stock reservation, order, payment, guaranteed fit, or confirmed dispatch.

## Frontend coverage

The customer app creates/submits requests, privately uploads an optional photo, restores request history, lists published options and accepts one using a saved delivery address. The supplier app loads its assignment inbox, marks viewed, skips, creates/submits quotations, and loads quotation history. Both reuse their in-memory access-token and rotating cookie session clients. Admin review/publication remains API-only.

Order, payment, fulfillment, full messaging and notification screens remain demonstrative or unavailable. Urgent estimates are conditional and never a guaranteed 30–60-minute promise.

## Persistence and checks

Migration `20261019120000_sourcing_commercial_workflow` adds quotation assignment/inventory/alternative links, clarification direction, public-number sequences, immutable option/version tables, customer clarifications and immutable acceptance snapshots. It is additive and retains prior data.

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test
```
