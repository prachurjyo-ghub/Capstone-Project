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

## Acceptance still needed

The interactive browser walkthrough from the supplier and admin portal screens did not complete. The browser access host was unavailable, and native Chrome control rejected actions while the user changed the app. Therefore supplier invitation activation, portal session restoration, a live request with photo through both operational UIs, listing moderation, and local notification delivery have not been signed off through the portal screens. The automated API suite verifies the underlying role and commerce flows but does not replace that UI check.
