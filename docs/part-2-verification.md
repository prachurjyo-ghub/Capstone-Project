# Part 2 local verification

Verified on 25 November 2026 (Asia/Dhaka) from `feature/part-2-operations`.

## Integrated source

- `S_db` and `A_db` were restored from `for-Fardin` branch `feature/supplier-admin-portals` into the Capstone feature branch in separate commits.
- Both portals use the shared API at `http://localhost:4000/api/v1` with the documented localhost ports.

## Checks completed

- Initialized fresh local PostgreSQL 17 demo and test databases; applied all 21 existing migrations to both and generated the Prisma client.
- Started local Redis 8, API, and worker. `GET /api/v1/health/readiness` reported `database`, `redis`, and `backgroundWorker` as `ready` and included a worker heartbeat.
- Ran `npm ci`, `npm run build`, and `npm run typecheck` successfully in `backend`, `C_frontend`, `S_db`, and `A_db`.
- Ran `npm test` in `A_db`: 2 files and 11 tests passed.
- Ran `npm test` in `backend` against the separate test database: 18 files and 113 tests passed. This includes sourcing requests and photos, supplier matching and quotations, admin option publication, customer acceptance, fulfillment, finance, and Redis worker coverage.
- Started all three portals and received HTTP 200 from the customer landing page and supplier and admin login pages.
- Provisioned a local test admin in the demo database. Credentials and runtime data are stored only in ignored local files.

## Follow-up completion audit

- Re-read both root README files and rechecked the running services. PostgreSQL is version 17.11 at `127.0.0.1:5433`; Redis listens at `127.0.0.1:6380`. Both demo and test databases have 21 completed migrations.
- Downloaded the exact documented Node 22.23.2 runtime from nodejs.org into the ignored `.local` directory. Repeated build and typecheck in all four apps successfully with that runtime; backend tests again passed 113/113 and admin tests 11/11. The original running development processes were started with the machine's Node 26 runtime.
- Lint passed in all four apps. The admin formatting check passed.
- The admin production dependency audit reported zero vulnerabilities. The backend production dependency audit reported four high-severity package findings in the Prisma configuration dependency chain (`prisma`, `@prisma/config`, `deepmerge-ts`, and `effect`). npm proposes a Prisma major upgrade; remediation and compatibility validation remain open. These counts represent affected packages, not four independently confirmed exploitable application defects.
- The demo database currently contains one admin user, zero suppliers, zero products, and zero sourcing requests. Automated test fixtures ran in the separate test database and are not a completed demonstration workflow.
- PR #3 remains open as a draft and has not been merged into `main`.

## First-day work checklist

This checklist is derived from the handoff; the README does not define a separate day-by-day schedule.

- Complete: clone and read the guides, create the requested feature branch, integrate each portal with separate commits and pushes, configure local services and ignored environment files, migrate fresh demo and test databases, provision the first admin, and run automated checks.
- Remaining: onboard a supplier through admin, accept its invitation, activate it, assign categories and entitlement, create catalogue data, submit and moderate a listing image, and check customer visibility.
- Remaining: complete a customer request with a photo through admin assignment, supplier quotation, admin option publication, customer acceptance, order fulfillment, and invoice; also verify the fixed-price and used-part flows, session restoration, access restrictions, local notification, and responsive UI.
- Remaining: resolve dependency audit findings, record the actual portal acceptance results, then complete review and merge.

## Acceptance still needed

The interactive browser walkthrough from the supplier and admin portal screens did not complete. The browser access host was unavailable, and native Chrome control rejected actions while the user changed the app. Therefore supplier invitation activation, portal session restoration, a live request with photo through both operational UIs, listing moderation, and local notification delivery have not been signed off through the portal screens. The automated API suite verifies the underlying role and commerce flows but does not replace that UI check.

## Resumed acceptance and dependency remediation

- Native Chrome control became available. Registered a demo customer, created a supplier business, category and product through the portals, and submitted `RFQ-2026-001000` with a bundled brake photo. The admin request detail and authorized photo viewer displayed the saved record. Customer and admin sessions survived reloads. Unauthenticated admin and customer attachment downloads returned HTTP 401.
- Supplier-owner invitation to the disposable local `owner@example.test` account is pending action-time approval required by automatic approval review. No owner access has been granted yet.
- Resolved the previously reported backend dependency findings using scoped `@prisma/config` overrides for `deepmerge-ts` 8.0.2 and `effect` 3.22.5, retaining Prisma 6.19.3. Under Node 22.23.2, Prisma generation, migration status, typecheck, build, all 113 backend tests, lint, and formatting of the changed manifests passed. `npm audit --omit=dev --audit-level=high` now reports zero vulnerabilities.
- Saved a customer delivery address through the UI. The demo database now contains three users (two admins and one customer), one draft supplier business with zero memberships, one category/product, and one custom sourcing request. The storefront category updated from the shared API. These live records supersede the empty-demo counts in the earlier audit.
- Inspected the storefront desktop appearance, bundled hero media, empty eligible-listings state, and admin light/dark appearance. A responsive inspection was started but was interrupted when Chrome switched windows; mobile acceptance is not yet signed off.
- Remaining portal acceptance depends on the pending supplier-owner access grant. The previously recorded backend dependency findings are resolved; the supplier invitation, entitlement, listing moderation, complete commercial workflow, fixed-price/used-part flows, supplier session/record isolation, and local notification checks remain open. Main is not yet merged.
