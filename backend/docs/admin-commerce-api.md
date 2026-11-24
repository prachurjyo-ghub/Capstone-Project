# Admin commerce operations and supplier-credit API

## Scope and rollout

This release adds the backend and Admin workflows for supplier listing classifications,
fixed-price purchase requests, used-parts RFQs, prepaid commission credits, and
commission accounting. Customer and Supplier portal UI work is intentionally deferred.

The migration is additive. Existing products remain shared catalogue references. Existing
supplier inventory rows retain a nullable classification until they are edited or migrated;
new writes infer a compatibility-safe classification when an older client omits the field.
Historical orders do not receive synthetic commission entries. Commission enforcement is
applied to `FIXED_PRICE_PURCHASE` and `USED_PART_RFQ` commitments, so existing custom
sourcing orders remain operational.

Do not enable future storefront controls until the checklist at the end of this document is
complete. No direct checkout is introduced by this release.

## Core classifications and request types

- `NEW_GENUINE`: new, properly identified genuine parts.
- `NEW_AFTERMARKET`: new compatible or aftermarket parts.
- `USED`: used, dismantled, refurbished, or salvaged parts with the existing condition
  disclosure.
- `FIXED_PRICE_PURCHASE`: request-to-purchase flow for genuine and aftermarket listings.
- `USED_PART_RFQ`: quotation flow for used listings.
- `CUSTOM_SOURCING`: the existing sourcing workflow.

The catalogue remains the global product reference. Supplier listings contain the supplier,
classification, advertised price, stock, publication state, and moderation state.

## API surface

All routes are below `/api/v1`. Authenticated supplier calls require `X-Business-Id` when a
user belongs to more than one business.

### Customer integration endpoints

`POST /customers/me/purchase-requests`

Creates an idempotent purchase request for a published `NEW_GENUINE` or
`NEW_AFTERMARKET` listing. Body:

```json
{
  "listingId": "uuid",
  "quantity": 2,
  "deliveryAddressId": "uuid",
  "customerNote": "Optional safe note",
  "idempotencyKey": "purchase-request-unique-key"
}
```

The request is valid even when the supplier currently lacks commission credits. The API
marks it `AWAITING_CREDITS`, notifies the supplier, and never exposes wallet balances to the
customer.

`POST /customers/me/requests` supports `requestType: "USED_PART_RFQ"` and an optional
`listingId`. A targeted used listing is validated and populated as a draft. Submitting the
draft with the existing `/customers/me/requests/{requestId}/submit` endpoint assigns it to
that listing's supplier with a bounded response deadline.

Existing option listing, acceptance, and order endpoints remain authoritative for used RFQs.
A routine used-parts quotation publishes a zero-platform-margin customer option without a
mandatory admin approval step. Admins retain monitoring, clarification, rejection, and
exception intervention.

Public catalogue summaries exclude `USED` listing amounts from `priceFrom` and expose
`quoteBasedAvailable` instead. This prevents the internal zero placeholder required by the
current inventory schema from being presented as a customer price.

### Supplier integration endpoints

- `GET /supplier/commerce/purchase-requests`: privacy-safe queue for the current business.
- `POST /supplier/commerce/purchase-requests/{requestId}/confirm`: validates current stock,
  creates or reuses the pending order, reserves stock and commission atomically, and confirms
  the order. A `409 INSUFFICIENT_COMMISSION_CREDITS` leaves the request and order pending.
- `GET /supplier/credits/wallet`: available/reserved balances and scoped history.
- `POST /supplier/credits/top-ups`: owner-only submission of amount, payment method,
  external reference, optional evidence reference/note, and idempotency key.
- Existing `/supplier/requests` and `/supplier/quotations` endpoints service used and custom
  RFQs. Supplier responses never receive customer email, phone, or exact delivery address.
- Existing `/supplier/fulfillment/{orderId}/availability` confirms accepted RFQ orders and
  reserves commission for used-part orders before moving them to `CONFIRMED`.

Supplier Portal integration extends these reads without adding a second business service:

- `GET /supplier/inventory` includes one-unit commission eligibility for fixed-price listings,
  derived from the active policy, listing state, stock, and the authenticated business wallet.
- The purchase-request queue includes required, available, and additional credit amounts for
  an understandable retry experience. Confirmation remains the authoritative credit check.
- The wallet response includes the active global policy snapshot and never exposes policy
  mutation controls.
- `GET /supplier/subscriptions/current` returns the membership-scoped current plan summary;
  plan enrollment remains Admin-controlled.

### Admin listing endpoints

- `GET /admin/listings`: global listing inspection with classification, publication,
  moderation, stock, price, supplier, and one-unit commission eligibility.
- `POST /admin/listings/{inventoryId}/moderation`: `APPROVED`, `FLAGGED`, or `REJECTED`
  with an audited reason. Rejection suspends publication.

### Admin finance endpoints

- `GET /admin/credits/overview`
- `GET|POST /admin/credits/policy` (`POST` is Super Admin only)
- `GET /admin/credits/wallets`
- `GET /admin/credits/wallets/{businessId}`
- `POST /admin/credits/wallets/{businessId}/adjustments` (Super Admin only)
- `GET /admin/credits/top-ups`
- `POST /admin/credits/top-ups/{topUpId}/decision`
- `GET /admin/credits/reservations`
- `POST /admin/credits/orders/{orderId}/commission-reversal` (Super Admin only)

Top-up approval is the only ordinary operation that converts externally verified payment
evidence into credits. Client-provided balances are never accepted.

## Commission accounting

One credit equals one BDT. The authoritative formula is:

`commission = eligible item total × snapshotted rate basis points / 10,000`

The eligible item total is the sum of confirmed `OrderItem.customerLineTotal` values. It
excludes delivery and priority charges. Calculations use Prisma Decimal and deterministic
half-up rounding to two decimal places.

For every wallet:

`total prepaid = available credits + reserved credits`

The immutable ledger records all balance deltas and the available/reserved balances after
each entry. The lifecycle is:

1. Confirmation locks the order and business wallet.
2. A policy/rate and eligible-price snapshot is stored in one reservation per order.
3. Available credits decrease and reserved credits increase.
4. Admin completion requires a verification/evidence note for commission-bearing orders.
5. Completion decreases reserved credits and creates a settlement entry exactly once.
6. Pre-settlement cancellation or operational failure restores available credits with a
   release entry.
7. An authorized post-settlement correction retains the original settlement and adds a
   compensating reversal entry.

Advisory transaction locks, unique order/idempotency constraints, non-negative database
checks, and append-only entries prevent overspending and duplicate charges. Two simultaneous
orders cannot reserve more than the available wallet balance.

Commercial amounts are immutable after confirmation in the current order API. A future
amount-change feature must adjust the reservation in the same transaction and must not edit
historical ledger entries.

## Admin navigation and consolidation

Before:

- Dashboard
- Requests and separate Quotation Review
- Orders and separate Cancellations & Returns
- Customers, Suppliers, Subscriptions, Catalogue
- Finance, Messages, Cases & Exceptions, Audit & System

After:

- Overview: Dashboard
- Commerce & sourcing: Requests, Orders
- Accounts: Customers, Suppliers, Subscriptions, Catalogue
- Operations: Finance, Messages, Issues & disputes
- Administration: Settings & audit

`/quotations` redirects to the RFQ view in Requests. `/cancellations` redirects to the
exceptions view in Orders. Request details retain quotation revisions and interventions;
order details retain cancellation, return, fulfillment, and commission actions.

## Security and privacy

- Supplier access is derived from active `SupplierUser` membership, never a body parameter.
- Wallets belong to `SupplierBusiness`; supplier routes cannot select another business.
- Admin and Super Admin roles can inspect operations. Policy changes, signed wallet
  adjustments, and settled-commission reversals require Super Admin.
- Customer contact and exact delivery snapshots are excluded from supplier purchase-request
  responses.
- Every consequential financial mutation writes an audit record and an idempotent outbox
  event.
- Public catalogue eligibility exposes ranking eligibility only, never wallet balances.

## Reconciliation

For a wallet, verify that the current balance equals the latest ledger balance snapshot and
that the sum of active reservation amounts equals `reservedCredit`. Top-ups must have one
`TOP_UP` entry only when approved. Each order can have at most one reservation and at most one
entry for reserve, settle, release, or reversal. The Admin wallet detail and commission views
expose these records without permitting edits.

## Customer and Supplier portal integration checklist

- Add listing classification and publication controls to the Supplier portal.
- Display wallet available/reserved balances without exposing administrative adjustment
  controls.
- Add owner-only top-up submission with evidence/reference fields.
- Add a purchase-request queue and retry-confirm action after a verified recharge.
- Never send customer email/phone/exact address to the supplier request screen.
- Add Customer storefront ranking: eligible fixed-price listings first, insufficient-credit
  listings still discoverable and requestable.
- Route genuine/aftermarket actions to `POST /customers/me/purchase-requests`; do not build
  direct checkout.
- Route used listings to `USED_PART_RFQ`, quotation options, and existing acceptance.
- Show `AWAITING_CREDITS` as a pending supplier condition without revealing balance data.
- Preserve idempotency keys across client retries.
- Handle `409 INSUFFICIENT_COMMISSION_CREDITS` as retryable after top-up approval.
- Add portal authorization tests for multi-business membership and cross-business denial.

## Known limitations

- No payment gateway was added; operations verifies external top-up evidence.
- Customer and Supplier UI controls are intentionally deferred.
- Existing unclassified listings are not bulk reclassified automatically.
- No supplier-specific or category-specific commission rates exist.
- No post-confirmation quantity/price editing endpoint exists; values are intentionally
  immutable until a transactional reservation-adjustment design is approved.
