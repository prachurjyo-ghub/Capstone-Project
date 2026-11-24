# Integration Checkpoint 1

Integration Checkpoint 1 connects the existing customer and supplier frontends to the Task
3–5 API. It does not implement sourcing, inventory, quotation, fulfillment, messaging,
transaction, or other Task 6 behavior.

## Local applications

| Application                      | Default origin                 | Connected scope                                                       |
| -------------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| Customer frontend (`C_frontend`) | `http://localhost:3000`        | Registration, login/logout, recovery, profile, addresses, vehicles    |
| Supplier frontend (`S_db`)       | `http://localhost:3001`        | Login/logout, invitation acceptance, membership/business access state |
| Backend (`backend`)              | `http://localhost:4000/api/v1` | Task 3–5 API                                                          |

There is no admin frontend in this repository. Task 4 supplier-management and Task 5 admin
customer-management endpoints therefore remain API-only; this checkpoint does not create an
admin portal.

Set the backend `CLIENT_ORIGINS` to the exact frontend origins. The checked-in development
example allows ports 3000, 3001 and 3002. Each frontend uses `NEXT_PUBLIC_API_BASE_URL` from
its own `.env.local`, with the values documented in the checked-in `.env.example` files.

## Session behavior

- Access tokens are held only in module memory and never written to local storage.
- Requests requiring cookies use `credentials: include`.
- Reload restoration calls `POST /auth/refresh` with the exact Origin, CSRF cookie/header pair,
  and an `X-Auth-Client` cookie namespace.
- A single in-tab refresh promise plus Web Locks/BroadcastChannel coordination serializes
  rotating refresh-token use. The fallback stores only a short-lived lock lease, never a token.
- A protected API request retries at most once after a 401. Authentication failure clears
  private frontend state.
- Customer and supplier sessions can coexist on localhost because their refresh and CSRF
  cookie names are distinct. The header selects only a namespace; roles and account/business
  restrictions are still loaded and enforced by the backend.

## Local recovery and invitations

Forgot-password always shows the backend's generic acknowledgement. In development, inspect
the ignored `RECOVERY_OUTBOX_DIR` and open the generated customer reset URL. Raw reset tokens
are not logged or returned by the API.

Supplier owner invitations are created through the Task 4 admin API. In development, inspect
the ignored shared `RECOVERY_OUTBOX_DIR` and open the generated supplier activation URL.
Acceptance binds the server-side email, business and owner role, creates no session, and does
not activate the business. The owner signs in separately and sees the current business status.

## Remaining frontend gap

An admin frontend and relevant management screens are absent. Connecting the existing admin
APIs requires a future focused admin UI. Supplier operational pages and customer sourcing
flows retain clearly labeled mock/browser-only behavior pending their corresponding backend
tasks.
