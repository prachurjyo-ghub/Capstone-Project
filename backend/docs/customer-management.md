# Customer and vehicle management

Task 5 adds authenticated customer self-service and admin customer management. All paths are
mounted under `API_PREFIX` (locally `/api/v1`) and use the standard
`{ success, data|error, requestId }` envelope.

Customer routes require a valid access token for a `CUSTOMER`. Admin routes require `ADMIN`
or `SUPER_ADMIN`. Identity is always taken from the authenticated session; customer endpoints
do not accept a customer ID.

## Customer endpoint contracts

| Method | Path                                         | Request / behavior                                                 |
| ------ | -------------------------------------------- | ------------------------------------------------------------------ |
| GET    | `/customers/me`                              | Return the safe account and customer profile                       |
| PATCH  | `/customers/me`                              | Any non-empty subset of `fullName`, `preferredName`, `companyName` |
| GET    | `/customers/me/addresses`                    | List active saved addresses, default first                         |
| POST   | `/customers/me/addresses`                    | Create a saved address; optional `isDefault`                       |
| PATCH  | `/customers/me/addresses/:addressId`         | Update editable address fields; default selection is separate      |
| POST   | `/customers/me/addresses/:addressId/default` | Select one owned active address as the default                     |
| DELETE | `/customers/me/addresses/:addressId`         | Soft-delete an owned saved address                                 |
| GET    | `/customers/me/vehicles`                     | List active saved vehicles                                         |
| POST   | `/customers/me/vehicles`                     | Create a saved vehicle                                             |
| PATCH  | `/customers/me/vehicles/:vehicleId`          | Update editable vehicle fields                                     |
| DELETE | `/customers/me/vehicles/:vehicleId`          | Soft-delete an owned saved vehicle                                 |

`preferredName` and `companyName` accept either a non-empty string or `null`. Email, phone,
password, role, account status, verification fields, profile notes, supplier memberships, and
security fields are not editable here. Email/login changes are deferred until a verified
change flow exists. Unknown fields are rejected instead of ignored.

### Address body

Creation requires:

- `recipientName`: 2–120 characters
- `phone`: international E.164 format
- `addressLine`: 5–250 characters
- `area`: 2–100 characters
- `city`: 2–100 characters

Optional fields are `label` (80), `addressLine2` (250), `postalCode` (20), `landmark` (180),
and `deliveryInstructions` (500); each may be a non-empty string or `null`. `isDefault` is an
optional boolean on creation and defaults to `false`. It is deliberately excluded from update
bodies so the dedicated default endpoint owns that transition.

Default changes take a customer-row lock and the database has a partial unique index enforcing
at most one active default per customer. Concurrent selections therefore serialize safely.
Deleting the current default promotes the oldest remaining active address; if none remains,
the customer has no default.

Deletion is logical (`isActive=false`, `deletedAt` set). Deleted addresses disappear from these
APIs but remain available to historical sourcing requests and orders. New order/request APIs
must snapshot delivery details where their workflow requires immutable display data.

Updating an address already referenced by a sourcing request or order uses copy-on-write: the
referenced row is retired unchanged and the response contains a new saved-address ID with the
requested edits. This prevents a profile edit from rewriting historical delivery information.

### Vehicle body

`make` (1–80) and `model` (1–100) are required on creation. Optional nullable fields are:

- `year`: integer from 1900 through next calendar year
- `variant`: up to 120 characters
- `registrationNumber`: up to 80 characters
- `chassisVin`: up to 100 characters
- `engineInfo`: up to 160 characters
- `notes`: up to 500 characters

A chassis/VIN is not forced to 17 characters because imported vehicles can use other chassis
formats. Vehicle deletion is logical (`isActive=false`, `deletedAt` set), preserving rows and
foreign-key references used by historical sourcing requests and request items.

Referenced vehicles also use copy-on-write when edited. The historical row is retired unchanged
and the response contains the new current vehicle ID.

Owned-resource lookups include the authenticated customer's profile ID. A missing record and
another customer's record both return the same 404 response.

## Admin endpoint contracts

| Method | Path                                  | Request / behavior                                       |
| ------ | ------------------------------------- | -------------------------------------------------------- |
| GET    | `/admin/customers`                    | Paginated customer-only listing                          |
| GET    | `/admin/customers/:userId`            | Safe customer details with active addresses and vehicles |
| PATCH  | `/admin/customers/:userId`            | Same approved profile fields as customer self-service    |
| POST   | `/admin/customers/:userId/suspend`    | Requires `{ "reason": "3–500 characters" }`              |
| POST   | `/admin/customers/:userId/reactivate` | Move a suspended customer to active                      |

Listing query parameters are `page` (default 1), `pageSize` (default 20, maximum 100), optional
`search`, and optional `status` using the existing `AccountStatus` enum. Search covers safe
identity/profile text fields. Only accounts with role `CUSTOMER` and a customer profile can be
returned or changed; supplier and admin accounts intentionally appear as not found.

Suspension is allowed from `ACTIVE` or `PENDING_VERIFICATION`, requires an audited reason, and
atomically revokes every refresh session. The existing authentication middleware checks the
session and account status on each protected request, so access stops immediately. Reactivation
is allowed only from `SUSPENDED`, sets the account to `ACTIVE`, and does not restore revoked
sessions; the customer must log in again. There is no hard-delete endpoint and no role change.

Audit metadata records action, actor, target, request ID, status/reason where required, and the
names of changed fields. It does not copy phone numbers, addresses, delivery instructions, or
vehicle values.

## Database and verification

Migration `20261018190000_customer_management` adds address delivery fields, logical-deletion
columns, an active-address index, and the partial unique default-address constraint. It also
adds `Vehicle.deletedAt`. Existing migrations are unchanged.

Run all checks against the dedicated `TEST_DATABASE_URL`:

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test
```

The integration suite refuses to substitute the development database for the configured test
database. No maps, geocoding, sourcing-request APIs, external services, or frontend wiring are
part of Task 5.
