# Supplier matching and request distribution (Task 8)

All paths are below `API_PREFIX` (normally `/api/v1`) and use the standard
`{ success, data|error, requestId }` envelope. Admin routes require `ADMIN` or
`SUPER_ADMIN`. Supplier routes require `SUPPLIER_OWNER` or `SUPPLIER_STAFF`, an active
membership, and an `ACTIVE` business. When a user has multiple active memberships,
`X-Business-Id` selects one membership; the header never grants access by itself.

Task 8 uses the supplier inbox as the only delivery mechanism. It sends no email/SMS and does
not automatically distribute suggestions. Assignment creation is the single service boundary
where a later task can enqueue notifications after the database transaction succeeds.

## Admin endpoints

| Method | Path                                                                                         | Purpose                                                |
| ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| GET    | `/admin/requests/:requestId/suggestions`                                                     | Read-only ranked supplier suggestions and explanations |
| POST   | `/admin/requests/:requestId/assignments`                                                     | Assign one or more selected suppliers                  |
| GET    | `/admin/requests/:requestId/assignments`                                                     | Assignment states, history, and clarifications         |
| PATCH  | `/admin/requests/:requestId/response-deadline`                                               | Change the deadline for active assignments             |
| POST   | `/admin/requests/:requestId/assignments/:assignmentId/withdraw`                              | Withdraw an active assignment with a reason            |
| POST   | `/admin/requests/:requestId/assignments/:assignmentId/clarifications/:clarificationId/reply` | Reply once to a supplier question                      |

Distribution accepts:

```json
{
  "responseDeadlineAt": "2026-10-19T12:00:00.000Z",
  "suppliers": [
    {
      "businessId": "supplier-business-uuid",
      "overrideReason": "Required only for a known category or location mismatch"
    }
  ]
}
```

The deadline must be strictly later than the server clock. A request can contain 1–50 unique
business targets. Only `SUBMITTED` or `MATCHING` requests can be distributed. The first created
assignment atomically changes `SUBMITTED -> MATCHING`, sets the shared response deadline, and
adds one request-status history entry. Later assignments must use the same deadline; changing it
requires the explicit deadline endpoint `{ "responseDeadlineAt": "..." }` so every active
assignment receives a `DEADLINE_CHANGED` history event.

Repeated or concurrent distribution of the same active request/business pair is idempotent:
the database uniqueness constraint and request-row lock yield one assignment and one `ASSIGNED`
history event. Task 8 does not reopen `SKIPPED`, `EXPIRED`, `WITHDRAWN`, or future `QUOTED`
assignments. There is intentionally no reopen endpoint.

Withdrawal requires `{ "reason": "3–500 characters" }`. Clarification replies require
`{ "reply": "1–2000 characters" }`; repeating the same reply is harmless, while replacing an
existing reply is rejected.

## Deterministic matching

Suggestions include only `ACTIVE` businesses having at least one active membership whose user
account is active and whose role is supplier owner/staff. Suspended, closed, draft, pending, or
memberless businesses are never suggested or assignable, including by override.

Scoring is deterministic:

- 100 points per request item with exact available inventory, matched by explicit product UUID
  or exact normalized part number.
- 25 points per request item whose known category slug appears in the business's configured
  supported categories.
- 15 points for an exact configured active-location/service-area match to the delivery area,
  or 10 points for a city match.
- Ties sort by business display name, then UUID.

Each suggestion returns item-level inventory/category coverage, category and location states,
an explanation list, and `requiresOverride`. Missing inventory is `UNKNOWN`, not a rejection:
suppliers may source items outside listed stock. Missing category/location configuration is also
uncertain and ranks lower. A known category or location mismatch requires an audited admin
override reason. Matching compares explicit IDs, exact part numbers, configured category slugs,
and exact normalized area/city labels only. It does not infer vehicle compatibility from free
text or claim verified geographic coverage.

## Supplier inbox endpoints

| Method | Path                                                         | Purpose                              |
| ------ | ------------------------------------------------------------ | ------------------------------------ |
| GET    | `/supplier/requests`                                         | Paginated inbox                      |
| GET    | `/supplier/requests/:assignmentId`                           | Supplier-safe request detail         |
| POST   | `/supplier/requests/:assignmentId/view`                      | Idempotently mark viewed             |
| POST   | `/supplier/requests/:assignmentId/skip`                      | Skip only this supplier's assignment |
| POST   | `/supplier/requests/:assignmentId/clarifications`            | Ask operations a focused question    |
| GET    | `/supplier/requests/:assignmentId/attachments/:attachmentId` | Authorized private photo download    |

Inbox query parameters are `page` (default `1`), `pageSize` (default `20`, maximum `100`),
optional assignment `status`, and optional request `urgency=STANDARD|URGENT`. Owners and staff
have the same Task 8 inbox permissions. Viewing is idempotent and never changes the deadline.
Skip accepts an optional `{ "reason": "3–500 characters" }`. Questions require
`{ "question": "3–1000 characters" }` and remain scoped to that assignment/business; only
admins see them outside that supplier.

Every lookup is scoped by the authenticated membership's business. Another business's
assignment or photo returns the same 404 as a missing record. Supplier responses revalidate the
current membership, business, request, assignment, and deadline while holding the request-row
lock.

## Privacy boundary

Supplier serializers expose:

- part description, exact submitted part number, quantity, explicit catalogue/category links;
- vehicle make/model/year/variant/engine information, but not registration or chassis/VIN;
- delivery area and city only;
- safe photo metadata and the assignment-authorized download endpoint;
- that supplier's clarification thread.

They omit customer identity, email/phone, recipient, exact address, postal/landmark/instructions,
customer notes, internal admin notes, attachment storage keys/hashes/original filenames, other
supplier identities, quotations, inventory prices, and private commercial data. Photos are
private objects and never public filesystem URLs. Customer-uploaded image pixels may themselves
contain names, plates, addresses, or other identifying content; Task 8 does not perform automatic
image redaction.

## State and deadline rules

```text
Request:    SUBMITTED --first assignment--> MATCHING
Assignment: ASSIGNED -> VIEWED
            ASSIGNED|VIEWED -> SKIPPED|EXPIRED|WITHDRAWN
```

Clarifications do not change assignment or request status. Phase 1 quotation submission sets
`QUOTED`; Task 8 itself does not. At `now >= responseDeadlineAt`, active assignments become `EXPIRED` during reads/actions
using the injected clock. No background job is required yet. Expired/skipped/withdrawn
assignments cannot view, skip, clarify, or download photos. Cancelled, expired, closed, accepted,
or ordered requests block supplier responses and attachment access immediately. A cancellation,
view/skip, deadline change, assignment, or withdrawal race serializes on the request row.

Historical inbox entries remain listable, but terminal assignments cannot respond. Deadline
extension is allowed only before expiry and only while active assignments exist; it cannot
silently revive an expired assignment.

## Migration and verification

Migration `20261019003000_supplier_matching` adds `withdrawnAt`, the append-only
`supplier_assignment_history` table, the focused `supplier_clarifications` table, and the
assignment-event enum. Existing assignment uniqueness and the request-level response deadline
are reused.

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test
```

Tests use `TEST_DATABASE_URL`, an injected mutable clock, and isolated private attachment
storage. Development data is never reset.
