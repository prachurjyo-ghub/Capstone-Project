# Supplier onboarding, subscriptions and category governance

## Access policy

Supplier operations require all of the following on every request: an `ACTIVE` user, a changed
temporary password, an active membership for the selected `X-Business-Id`, an `ACTIVE` business,
and either a current subscription period or its finite migration grace period. The entitlement
interval is half-open: `startsAt <= now < endsAt`; access is denied at the exact `endsAt` instant.
Login and refresh require at least one eligible membership, while each operational request checks
the selected business again. Billing history, password setup/recovery and logout remain available
without operational entitlement. One expired or suspended membership does not block another
eligible business belonging to the same user.

The migration gives businesses that were already `ACTIVE` a 30-day review grace period. It does
not create a lifetime grant and new businesses receive no grace. Operations must review each
existing business and issue a paid period or an explicitly reasoned `SUPER_ADMIN` complimentary
grant before that date. Expiry/suspension prevents new inventory, assignment and quotation work
and makes the business ineligible for matching. Existing accepted orders, reservations, ledgers
and history are preserved for operations; nothing is silently cancelled or released.

## Admin onboarding

- `POST /api/v1/admin/suppliers/:businessId/owner-account` creates the one initial owner with an
  admin-entered temporary password. The response never contains it. The owner must call
  `POST /api/v1/auth/change-password` before supplier operations.
- `POST /api/v1/admin/suppliers/:businessId/members/:membershipId/account-status` suspends or
  reactivates the individual account with a reason. Suspension revokes all of that user's refresh
  sessions and may affect their other memberships; it does not change business/subscription state.
- `POST /api/v1/admin/suppliers/:businessId/members/:membershipId/temporary-password` recovers an
  existing supplier account by setting a new temporary password, revoking its sessions and
  requiring the member to change that password at next sign-in.
- Existing invitation onboarding remains available. The admin must still explicitly activate the
  business and establish subscription entitlement.

## Plans, periods and billing

Admin routes are under `/api/v1/admin/subscriptions`:

- `GET|POST /plans`, `PATCH /plans/:id`
- `GET /` with bounded `page`, `pageSize`, `businessId`, `status`, `expiringBefore`
- `POST /complimentary-grants` (`SUPER_ADMIN` only, reason and idempotency key required)
- `POST /:id/suspend|reactivate|cancel`
- `GET|POST /invoices`, `GET /invoices/:invoiceId`, `GET /invoices/:invoiceId/pdf`
- `POST /invoices/:invoiceId/payments`, `POST /invoices/:invoiceId/void`
- `POST /payments/:paymentId/reversals`
- `GET /dashboard?from=...&to=...&timezone=Asia/Dhaka`

Supplier owners can list/view/download their own private subscription invoices at
`/api/v1/supplier/subscriptions/invoices`; staff cannot. Supported plan terms are 1, 4 and 12
calendar months. Month addition clamps to the destination month's last day (for example, January
31 plus one month becomes February 28, or February 29 in a leap year).

An issued invoice snapshots the plan, BDT amount, period, supplier billing identity and configured
seller identity. Partial external receipts reduce the outstanding balance but do not activate the
period. Full payment activates it (`SCHEDULED` when it begins later). Early renewal starts at the
latest paid-through or pending-invoice endpoint; renewal after expiry starts at the current instant.
Business-scoped advisory locks prevent overlapping concurrent renewals. Amounts use Decimal with
two displayed places. Overpayment is rejected. External references are case-normalized and unique
across subscription receipts. Idempotency keys make issue/payment/grant/reversal retries safe.

Receipts and reversals only record activity performed outside PartsArc. They never transfer money.
Posted receipts are corrected by linked reversal, not edit/delete. Reversing a receipt suspends the
associated entitlement for operations review. An invoice with payment history cannot be voided
until those receipts are reversed. Subscription billing is separate from customer order invoices,
supplier payables, settlements and payouts; no tax or recurring billing is inferred.

## Category requests

Active entitled supplier owner/staff members use:

- `GET /api/v1/supplier/subscriptions/category-requests`
- `POST /api/v1/supplier/subscriptions/category-requests`

They provide `proposedName`, optional `proposedParentId`/description, and justification. A partial
unique index permits only one pending normalized name per business while retaining decided
history. Admins list requests at `GET /api/v1/admin/catalogue/category-requests` and decide them at
`POST /api/v1/admin/catalogue/category-requests/:id/decision`. Approval either atomically creates
the category or links an existing equivalent; repeat decisions fail and an outbox notification is
queued. Category parent cycles and referenced-category archival remain governed by catalogue
rules. Suppliers never create global categories or catalogue products directly. Once approved,
the category is available to the admin catalogue publication workflow and then supplier offerings
can reference products published in it.

## Customer privacy

Customer option and order serializers expose manufacturer/brand, fitment notes, customer prices
and public commercial snapshots, but not supplier business/user identifiers, names, contacts,
costs, margins, inventory IDs or offering metadata. Customer message downloads receive generic
attachment filenames. Supplier inventory and prices remain membership scoped. Global product
copy is admin-owned; supplier category proposals are reviewed before publication. Free text and
image pixels can still contain identity, so operations must review proposed content—no automated
anonymity guarantee is claimed.
