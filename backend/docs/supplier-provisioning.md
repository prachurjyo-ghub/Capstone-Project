# Supplier account provisioning

Task 4 adds admin-managed supplier businesses and initial-owner invitations. Public customer
registration remains customer-only. Every admin endpoint requires a valid Task 3 access token
with `ADMIN` or `SUPER_ADMIN` role.

All paths are mounted under `API_PREFIX` (locally `/api/v1`) and use the existing
`{ success, data|error, requestId }` envelope.

## Endpoint contracts

| Method | Path                                                            | Purpose                                                                        |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| POST   | `/admin/suppliers`                                              | Create a `DRAFT` supplier business; the business code is generated server-side |
| GET    | `/admin/suppliers`                                              | List businesses with `page`, `pageSize`, `status`, and `search` filters        |
| GET    | `/admin/suppliers/:businessId`                                  | View safe business, owner, location, and count data                            |
| PATCH  | `/admin/suppliers/:businessId`                                  | Update business information and service areas                                  |
| PUT    | `/admin/suppliers/:businessId/supported-categories`             | Replace active category slugs supported by the business                        |
| POST   | `/admin/suppliers/:businessId/locations`                        | Create a location                                                              |
| PATCH  | `/admin/suppliers/:businessId/locations/:locationId`            | Update a location owned by the business                                        |
| DELETE | `/admin/suppliers/:businessId/locations/:locationId`            | Soft-deactivate a location                                                     |
| POST   | `/admin/suppliers/:businessId/invitations/owner`                | Invite the initial owner                                                       |
| GET    | `/admin/suppliers/:businessId/invitations`                      | List safe invitation status/history                                            |
| GET    | `/admin/suppliers/:businessId/invitations/:invitationId`        | View one safe invitation record                                                |
| POST   | `/admin/suppliers/:businessId/invitations/:invitationId/resend` | Revoke the prior pending/expired link and issue a replacement                  |
| POST   | `/admin/suppliers/:businessId/invitations/:invitationId/revoke` | Revoke a pending invitation                                                    |
| POST   | `/admin/suppliers/:businessId/status/submit-review`             | Move `DRAFT` to `PENDING_REVIEW`                                               |
| POST   | `/admin/suppliers/:businessId/status/activate`                  | Explicitly activate or reactivate an owner-backed business                     |
| POST   | `/admin/suppliers/:businessId/status/suspend`                   | Suspend an active business; requires `{ reason }`                              |
| POST   | `/admin/suppliers/:businessId/status/disable`                   | Permanently close a business; accepts optional `{ reason }`                    |
| POST   | `/supplier-invitations/accept`                                  | Public, rate-limited owner acceptance with `{ token, fullName, password }`     |

Invitation responses never contain raw tokens or token hashes. Acceptance never returns an
access token or creates a session; the new owner signs in through `/auth/login`.

## Status transition policy

```text
DRAFT -> PENDING_REVIEW -> ACTIVE -> SUSPENDED -> ACTIVE
   \           \            \          \
    +-----------+------------+-----------+-> CLOSED
```

- `DRAFT` is assigned at creation. Owner acceptance does not change it.
- `PENDING_REVIEW` requires an explicit admin submission.
- Initial activation requires `PENDING_REVIEW`, an accepted owner, and that owner's active
  primary membership.
- Reactivation is allowed from `SUSPENDED` after admin review.
- Suspension is allowed only from `ACTIVE`.
- `CLOSED` is the existing schema's permanent disabled state and is terminal/read-only.
- No endpoint hard-deletes a business. Historical operational and financial relationships are
  preserved. Location deletion is also implemented as deactivation.

Suspension retains memberships but immediately blocks them because supplier authorization
checks `SupplierBusiness.status` on every request. Suspension and closure also revoke all
current member sessions. Closure deactivates current memberships. User accounts remain active
because a user could later belong to another business; admins manage global account status
separately.

## Initial-owner invitation flow

1. An admin creates a business and issues one `SUPPLIER_OWNER` invitation.
2. A random token is delivered; only its keyed hash is stored.
3. The invitee submits only the token, name, and a Task 3-compliant password.
4. One serializable transaction claims the invitation and creates the `SUPPLIER_OWNER` user,
   primary `SupplierUser` membership, business owner reference, and audit event.
5. The business remains `DRAFT`; the owner must sign in normally after an admin activates it.

The migration adds database-enforced partial unique indexes for one current primary membership
and one pending owner invitation per business. Resending invalidates the previous database
record before creating a new link. Invalid, expired, revoked, and previously used public links
receive the same safe error.

If the invited email already belongs to any account, acceptance returns
`INVITED_EMAIL_ALREADY_REGISTERED`. It does not change the password or global role and does
not create a membership. Authenticated account linking, staff invitations, and ownership
transfer are intentionally deferred.

## Delivery and local testing

Configure:

```env
SUPPLIER_INVITATION_TTL_HOURS=72
SUPPLIER_INVITATION_URL_BASE=http://localhost:3001/accept-invitation
RECOVERY_OUTBOX_DIR=.local/recovery-outbox
```

In development, supplier invitation messages are written as mode-0600 JSON files in the same
ignored local outbox used by password recovery. The raw activation link exists only in that
file and in the injected delivery provider. It is not logged, audited, persisted as plaintext,
or returned from the API.

Production startup requires an explicitly injected `SupplierInvitationDelivery`; it will not
fall back to the local outbox. If a provider fails after persistence, the API returns a delivery
error and records a safe audit event. The admin can list the invitation and resend it.

## Verification

```bash
npm run prisma:validate
npm run prisma:generate
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Tests use only `TEST_DATABASE_URL`; they do not reset or seed the development database.
