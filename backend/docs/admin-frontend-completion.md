# Admin operations, subscriptions and category-governance completion

## Delivered on 2026-10-22

The `A_db` Next.js application is an authenticated graphite/charcoal/stone operations workspace
on port 3002. The dashboard now uses a compact subscription-aware KPI strip, real Asia/Dhaka
date-bounded request/order activity, one unified oldest-first attention table, a subscription
overview and meaningful audit activity without routine login/refresh noise.

Connected workflows include sourcing assignment, quotation comparison/publication, acceptance
conversion, fulfillment, cancellations/returns, customer administration, supplier provisioning,
catalogue/reference governance, finance, private operations messages, case history, audit and
system controls. This iteration additionally delivers:

- direct initial-owner onboarding with mandatory temporary-password change;
- independent business, user-account and subscription status controls;
- 1/4/12 calendar-month supplier plans, invoice/payment history, paid activation, early/expired
  renewal rules, suspension/reactivation/cancellation, corrections and reasoned grants;
- supplier-owned category requests and atomic admin decisions;
- product part-number/compatibility child editing;
- selectable settlement allocations, private message uploads, case detail/history, invoice void,
  financial reversal and refund-completion controls.

The client retains memory-only access tokens, namespaced HttpOnly refresh cookies, CSRF validation,
cross-tab refresh coordination, shadcn/ui-style primitives, Lucide/React icons, password visibility,
skeleton states and light/dark/system themes. It never falls back to mock persistence.

## Database transition

Two additive migrations introduce subscriptions, separate subscription billing, category requests
and temporary-password state, then replace an overly broad category-request uniqueness constraint
with a partial pending-only index. Existing `ACTIVE` development businesses received a finite
30-day review grace period. New businesses receive none. Operations must review and convert every
legacy grace period to a paid or explicitly complimentary period; no lifetime access was granted.

## Verification

- Prisma validate/generate, backend typecheck, ESLint, Prettier, OpenAPI validation (19 published
  operations) and production build: passed.
- PostgreSQL regression suite: 12 files and 74 tests passed. The live-Redis file and its three tests
  remained skipped because `REDIS_URL` is not configured locally.
- Admin unit suite: 2 files and 11 tests passed; typecheck, ESLint, Prettier and production webpack
  build passed.
- Supplier typecheck, ESLint and production build passed. Customer typecheck and production build
  passed.
- Development health returned 200; readiness returned 200/degraded with PostgreSQL ready, Redis
  not configured, no worker heartbeat, and four pre-existing pending outbox records.
- A diff/ignore scan found no committed environment files, private keys, raw recovery/invitation
  links or plaintext generated credentials.

No Chromium, Chrome, Firefox or Playwright runtime is installed, so browser acceptance was not
executed. Builds and HTTP checks are not counted as browser proof. After installing the project's
chosen browser runner, start API/customer/supplier/admin on ports 4000/3000/3001/3002 and run the
staging checklist in `admin-operations-frontend.md` with isolated records.

## Remaining boundaries

The application is locally build-ready but not staging-accepted until browser checks cover mobile,
both themes, reload, deep links, multiple tabs, exact subscription expiry and the full onboarding /
billing / category decision workflow. Redis/worker verification remains a separate existing
deployment gate. No payment transfer, recurring billing, automatic identity-redaction guarantee,
staff invitation, ownership transfer or admin deployment was added.
