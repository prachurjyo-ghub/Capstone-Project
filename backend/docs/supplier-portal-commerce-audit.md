# Supplier Portal commerce integration audit

## Baseline

The Supplier Portal is a Next.js application in `S_db`. It already uses the shared
cookie/bearer authentication flow, resolves an active `SupplierUser` membership, and sends
`X-Business-Id` for supplier-scoped API calls. The portal has responsive shared panels,
tables, dialogs, drawers, status badges, loading skeletons, dark mode, notifications, and a
mobile sidebar. These components should be reused.

The portal's current navigation reflects the older implementation: Overview, Request Inbox,
My Quotations, Fulfillment, Inventory, Transactions, Messages, category requests, and
Business Profile. Inventory, used/custom RFQ responses, quotation revisions, order status
updates, profile reads, notifications, and subscription invoices are connected to real APIs.
The portal does not yet expose fixed-price purchase requests, the prepaid commission wallet,
listing classification/publication/moderation, credit eligibility, or a current subscription
summary.

## Authoritative backend capabilities

- `SupplierInventory` is the supplier-owned listing and inventory aggregate. Supplier routes
  already enforce active membership and object-level `businessId` ownership.
- Listing writes already accept `NEW_GENUINE`, `NEW_AFTERMARKET`, and `USED`, as well as
  draft/published state. Admin moderation uses the same records.
- `/supplier/commerce/purchase-requests` is the privacy-safe fixed-price queue. Its confirm
  operation atomically creates/reuses an order, reserves stock and commission, and remains
  retryable when credits are insufficient.
- `/supplier/requests` and `/supplier/quotations` remain authoritative for used/custom RFQs,
  quotation submission, clarification, revision history, expiry, and withdrawal.
- `/supplier/fulfillment` is the only supplier order workflow. Its response includes the
  commission reservation snapshot, and its allowed transitions are server-enforced.
- `/supplier/credits/wallet` and `/supplier/credits/top-ups` expose the business wallet,
  immutable ledger, reservations, manual top-up history, and owner-only top-up submission.
- Supplier profile, notification, messages, subscription invoice, and category-request APIs
  are reusable. Customer contact data and exact delivery addresses are already excluded from
  supplier request/order responses.

## Focused gaps addressed in this branch

1. Supplier listing reads did not include one-unit commission eligibility, although the Admin
   listing view calculated it. The supplier response now derives the same information from
   the active global policy and the authenticated business wallet.
2. The wallet response did not include the active global commission policy. It now includes a
   read-only policy snapshot so the portal never calculates or configures the policy itself.
3. The supplier could read subscription invoices but not its current plan. A read-only,
   membership-scoped `/supplier/subscriptions/current` endpoint now returns the latest
   applicable subscription and effective status.

No duplicate wallet, order, request, quotation, notification, payment, or subscription
system is introduced. Supplier top-ups remain manual and non-spendable until Admin approval.

## Known constraints

- Listing image upload is not supported by the current listing API.
- Top-ups use external payment references/evidence; no payment gateway exists.
- Supplier-managed subscription renewal is not implemented; enrollment remains Admin-owned.
- Fixed-price purchase requests have confirmation but no supplier-decline mutation in the
  current backend. The portal does not invent a decline state.
- Existing historical listings can have a null classification until explicitly updated.
