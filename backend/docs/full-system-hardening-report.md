# PartsArc full-system hardening report

Date: 2026-10-30
Branch: `feat/full-system-hardening`
Base: `127c0b7` (`feat/customer-storefront-commerce`)

## Executive status

The customer, supplier, and admin frontends now build successfully and pass a deterministic six-scenario Chromium suite with reviewed visual baselines. Mobile landing-page density, the customer footer, shared admin search fields, and authenticated four-item bottom navigation were corrected.

The live Supplier and Admin failure was reproduced and has an evidence-based cause: the Render Free backend hibernates and its routing layer returns non-JSON `429`/`502` responses while the service wakes. The frontend previously labelled those responses as an unreadable API response. The code now identifies Render routing failures, polls health, retries the original request only after recovery, and otherwise shows a truthful recoverable message.

The current production aliases do not contain this branch. No production deployment, configuration mutation, database migration, or production-data mutation was performed.

## A. Deployment recovery

Affected production aliases:

- Customer: `https://partarc-by-ahp.vercel.app`
- Admin: `https://admin-partsarc.vercel.app`
- Supplier: `https://supplier-partsarc.vercel.app`
- Backend: `https://partsarc-prototype-api.onrender.com`

### Reproduction and root cause

Before waking the backend, `/api/v1/health` through all three Vercel aliases returned plain-text `429` with `x-render-routing: hibernate-rate-limited`. Admin and Supplier refresh requests returned HTML `502` with `x-render-routing: no-deploy`. Those bodies cannot satisfy the JSON API envelope and produced the reported unreadable-response error.

A direct request to the Render health endpoint returned valid JSON after approximately 25 seconds and showed a newly started process. Immediately afterward, all three Vercel aliases returned valid `200` JSON health responses. The frontend bundles use `/api/v1`, and each Next.js application rewrites `/api/:path*` through `API_INTERNAL_URL`; this rules out an incorrect public API base as the cause of this incident.

`render.yaml` confirms the backend is on Render's `free` plan. This is a hosting lifecycle issue, not a Next.js RSC failure, schema failure, or demonstrated CORS failure.

### Corrective code

All three API clients now:

1. Detect only `429`, `502`, `503`, or `504` responses carrying `x-render-routing`.
2. Poll the API health endpoint with bounded backoff.
3. Retry the original request after health succeeds. Retrying is safe in this case because the Render routing response proves the original request did not reach the application.
4. Present `SERVICE_WAKING` with a readable wait-and-retry message when the backend remains unavailable.

Ordinary application errors, validation failures, and authorization failures are not retried or hidden.

### Verification and rollout action

- Local production builds passed for all three frontends.
- Browser auth restoration and authorized portal rendering passed with deterministic API fixtures.
- Live read-only probes confirmed the backend/proxy path recovers after wake-up.
- No preview was created because the repository has no existing `.vercel/project.json` project linkage; creating or guessing new project links was not treated as permitted deployment configuration.
- The code fix requires deployment of all three frontend projects before it can appear on the production aliases.
- Reliable first-request availability still requires an always-on Render plan or another always-on backend host. Client recovery improves the experience but cannot guarantee uptime for a sleeping service.

## B. Frontend visual QA

### Customer changes

- Reduced mobile hero padding, heading scale, search height, section spacing, image height, and card minimum heights without fixed-height content clipping.
- Kept primary search and sourcing actions prominent.
- Changed the mobile footer to compact accordions while retaining all links.
- Fixed the 320px header overflow by hiding only the secondary logo strapline below 350px.
- Fixed a cascade issue that rendered mobile accordion and desktop footer groups simultaneously.

### Shared and admin changes

- Replaced overlapping absolute-icon search fields with shared flex-based `SearchField` and `SearchControl` components. Admin resource lists, Catalogue, Subscriptions, and Supplier top-bar/listing/inventory/request/message searches now give the icon real layout space instead of depending on fragile input padding.
- Preserved the existing admin desktop layout.
- Added safe bottom padding so fixed navigation does not cover page content.

### Browser coverage

The customer landing page was checked at widths 320, 360, 375, 390, 414, 768, 1024, 1280, and 1440. A landscape dark-theme pass was also run at 844x390. Authenticated customer, supplier, and admin workflows were rendered at 390x844; admin dashboard and finance were rendered at 1440px.

Automated document-level overflow assertions passed. Screenshots were manually reviewed for hierarchy, footer duplication, fixed-nav coverage, drawer reachability, financial figure readability, and search text/icon separation.

Before/after evidence:

- [Current production customer mobile](visual-qa/customer-landing-before-production.png)
- [Hardened local customer mobile](visual-qa/customer-landing-after-local.png)
- Additional approved baselines are under `qa/e2e/responsive.spec.ts-snapshots/`.

Remaining limitation: full-page screenshots position fixed bottom navigation relative to the captured viewport segment. Interactive viewport testing confirmed the navigation remains fixed at the device bottom and content has compensating padding.

## C. Mobile navigation

### Customer

Authenticated customers receive Home, Browse, My Requests, and More. The drawer exposes Quotations, My Orders, Custom Sourcing, and Account. Public/auth pages keep their existing public navigation.

### Supplier

Overview, My Listings, Requests, and More are direct items. More exposes Orders, Quotations, Credit Wallet, and Business & Account. Drawer links close the accessible sheet before navigation.

### Admin

Overview, Requests, Orders, and More are direct items. More exposes Customers, Suppliers, Subscriptions, Catalogue, Finance, Issues & disputes, Messages, and Settings & audit.

All implementations use approximately 56px navigation targets, safe-area bottom padding, route-aware active states, scrollable accessible drawers, and page bottom spacing. Existing desktop sidebars remain unchanged.

## D. System hardening audit

### Architecture and performance

- The three Next.js clients keep access tokens in memory and use client-specific refresh/CSRF cookie namespaces.
- Same-origin `/api/v1` requests are rewritten server-side to `API_INTERNAL_URL` in Vercel.
- The new recovery logic is restricted to Render routing failures and is bounded, preventing a general auth retry loop.
- No new cache or duplicated dashboard fetch layer was introduced.
- The admin dashboard still aggregates several operational endpoints; backend wake time, rather than rendering, was the demonstrated cause of the extreme initial delay.

### Authorization and privacy

- Supplier middleware resolves `x-business-id` only against active memberships and active businesses, requires current entitlement, and blocks operational access while a password change is required.
- Customer commerce reads are scoped through the authenticated customer profile; supplier finance, credit eligibility, contact details, and internal notes remain excluded from customer payloads.
- No authorization or privacy semantics were changed in this branch.

### Financial integrity

Read-only review confirmed the established model remains intact:

- Commission is calculated from snapshotted customer order line totals using basis points, not supplier profit.
- Supplier top-up submission does not change spendable credit; only an admin approval transaction increments available credit and creates the ledger/audit/outbox records.
- Reservation atomically moves value from available to reserved credit under an order lock and records the policy/rate/eligible-amount snapshot.
- Insufficient credit marks the request as awaiting credits without creating a reservation.
- Settlement, release, and reversal are state-checked, idempotent by order-derived keys, ledgered, and audited.
- Prepaid credit liability and settled commission revenue remain distinct.

Backend financial code was not modified, so the already reported backend result (91 passed, 3 Redis-dependent skipped) was not needlessly rerun.

## E. Test report

| Check                                       | Result                              |
| ------------------------------------------- | ----------------------------------- |
| Customer TypeScript                         | Passed                              |
| Supplier TypeScript                         | Passed                              |
| Admin TypeScript                            | Passed                              |
| Supplier ESLint                             | Passed                              |
| Admin ESLint                                | Passed                              |
| Customer production build                   | Passed                              |
| Supplier production build                   | Passed                              |
| Admin production build                      | Passed                              |
| Playwright Chromium functional/visual suite | 6 passed                            |
| Visual baseline re-run without updates      | 6 passed                            |
| Backend suite                               | Not rerun; no backend files changed |

Browser scenarios cover customer responsive landing and dark landscape, customer browsing/dashboard/More drawer, supplier dashboard/drawer, supplier listing search and wallet, admin mobile/desktop dashboard, admin finance, admin catalogue and resource-list searches, four-item nav counts, and horizontal overflow. Search tests measure icon and input bounding boxes and fail if they overlap.

Run locally with:

```bash
npm run test:e2e
```

Baseline changes must be deliberately reviewed before running `npm run test:e2e:update`.

## F. Production readiness

### Remaining blockers

1. The branch is not deployed, so production still has the old API error handling and old responsive UI.
2. Render Free hibernation remains a reliability risk. Upgrade to an always-on service before claiming production-grade availability.
3. Confirm the backend `CLIENT_ORIGINS` contains exactly the three production Vercel origins (and approved preview origins, if previews are used).
4. Confirm each Vercel project has `NEXT_PUBLIC_API_BASE_URL=/api/v1`, `API_INTERNAL_URL=https://partsarc-prototype-api.onrender.com`, and `NEXT_PUBLIC_CSRF_COOKIE_NAME=partsarc_csrf` for the intended environment.
5. Keep `COOKIE_SECURE=true`, the current cookie namespace, Redis-backed auth rate limiting, database URL, storage, and email secrets unchanged unless reviewed separately.

No schema change or migration is required for this branch.

### Staging checklist

1. Link each local application to the existing Vercel project by verified project ID/name; do not create substitute projects.
2. Deploy branch previews for Customer, Supplier, and Admin.
3. Verify preview origins are deliberately allowed by backend origin/CSRF policy, or validate through production aliases during an approved rollout.
4. Let Render sleep, then test customer catalogue, supplier login/dashboard, and admin login/dashboard from a cold start.
5. Confirm the waking message appears and the original request resumes after health recovery.
6. Repeat mobile navigation, search, wallet, and admin finance smoke tests using non-production or approved test accounts.

### Production deployment checklist

1. Upgrade or otherwise make the backend always-on.
2. Verify Render health, database, Redis, worker heartbeat, storage, and email configuration.
3. Verify Vercel environment variables and backend allowed origins without exposing values in logs.
4. Deploy the backend only if its hosting configuration changes; no backend code from this branch needs deployment.
5. Deploy Customer, Supplier, and Admin from the same reviewed commit.
6. Smoke-test auth refresh, CSRF-protected mutations, catalogue, supplier wallet, and admin finance.
7. Monitor Render/Vercel status codes and application request IDs.

### Rollback

If frontend smoke tests fail, immediately re-alias each Vercel project to its previous known-good production deployment. No database rollback is required because this branch has no migrations or data changes. If an always-on Render change fails, restore the previous service plan/configuration only after preserving logs, while keeping the previous frontend aliases available.

## G. Git safety

Only hardening implementation, test infrastructure/baselines, and this report should be committed. Pre-existing staged deletions, modified READMEs/TypeScript configuration, and untracked `BLUEPRINT.md`/`DEMONSTRATION.md` are unrelated user work and must remain outside this branch's commit.

The branch must be pushed as `feat/full-system-hardening`; it must not be merged or deployed to production without approval.
