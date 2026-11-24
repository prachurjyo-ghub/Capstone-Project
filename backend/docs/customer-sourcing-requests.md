# Customer sourcing requests (Task 7)

All routes are below `API_PREFIX` (normally `/api/v1`) and use the standard
`{ success, data|error, requestId }` envelope. Customer routes require an active authenticated
`CUSTOMER`; identity is derived from the access token and never accepted in a payload. Admin
routes require `ADMIN` or `SUPER_ADMIN`. Inaccessible and other-customer records return the same
404 response.

## Customer endpoints

| Method | Path                                                          | Purpose                                   |
| ------ | ------------------------------------------------------------- | ----------------------------------------- |
| POST   | `/customers/me/requests`                                      | Create an incomplete or complete draft    |
| GET    | `/customers/me/requests`                                      | List owned requests                       |
| GET    | `/customers/me/requests/:requestId`                           | View details and customer-visible history |
| PATCH  | `/customers/me/requests/:requestId`                           | Update draft request fields               |
| POST   | `/customers/me/requests/:requestId/items`                     | Add a draft item                          |
| PATCH  | `/customers/me/requests/:requestId/items/:itemId`             | Update an owned draft item                |
| DELETE | `/customers/me/requests/:requestId/items/:itemId`             | Remove an owned draft item and its photos |
| POST   | `/customers/me/requests/:requestId/attachments`               | Upload a private draft photo              |
| GET    | `/customers/me/requests/:requestId/attachments/:attachmentId` | Authorized private photo download         |
| DELETE | `/customers/me/requests/:requestId/attachments/:attachmentId` | Remove a draft photo                      |
| POST   | `/customers/me/requests/:requestId/submit`                    | Validate and submit a draft idempotently  |
| POST   | `/customers/me/requests/:requestId/cancel`                    | Cancel an eligible request                |

List query parameters are `page` (default `1`), `pageSize` (default `20`, maximum `100`),
optional `status`, and optional `urgency=STANDARD|URGENT`.

### Draft body

`POST` accepts the following strict JSON shape; every field is optional and `items` defaults to
an empty array so a customer can save an incomplete draft:

```json
{
  "title": "Brake service parts",
  "customerNotes": "Please match the original specification",
  "urgency": "STANDARD",
  "neededByAt": "2026-10-20T09:00:00.000Z",
  "vehicleId": "saved-vehicle-uuid",
  "manualVehicle": {
    "make": "Toyota",
    "model": "Axio",
    "year": 2016,
    "variant": "G",
    "registrationNumber": null,
    "chassisVin": null,
    "engineInfo": null
  },
  "deliveryAddressId": "saved-address-uuid",
  "manualDelivery": {
    "recipientName": "Customer Name",
    "phone": "+8801700000000",
    "addressLine": "12 Example Road",
    "addressLine2": null,
    "area": "Dhanmondi",
    "city": "Dhaka",
    "postalCode": "1209",
    "landmark": null,
    "deliveryInstructions": null
  },
  "items": [
    {
      "description": "Front brake pad",
      "partNumber": "04465-0D150",
      "productId": null,
      "categoryId": null,
      "quantity": 2,
      "customerNotes": null
    }
  ]
}
```

Choose either `vehicleId` or `manualVehicle`, and either `deliveryAddressId` or
`manualDelivery`; sending both alternatives is rejected. Saved references are ownership scoped.
`PATCH` accepts any non-empty subset of the request fields, excluding `items`. Item creation
uses the item object above; item update accepts any non-empty subset. Quantity is `1–999`, a
request contains at most 50 items, and text/year lengths follow the saved-vehicle/address rules.
Unknown or protected fields—including customer IDs, statuses, assignment data, internal notes,
prices, and supplier data—are rejected.

Drafts may be incomplete. Submission requires at least one item, a usable vehicle (saved or
manual make/model), complete delivery details, and a future `neededByAt` when supplied. Every
item needs a non-empty description, part number, or directly associated photo. A request-level
photo can identify the item only when the request has one item. A catalogue match is optional;
when a product/category UUID is supplied it must reference an active record.

Submit with:

```json
{ "idempotencyKey": "client-generated-stable-key" }
```

The key is 8–120 characters and must be reused for retries of the same submission. Concurrent
retries serialize on the request row and produce one `SUBMITTED` history entry. Reusing a key
for another request owned by the same customer is a conflict. Human-readable numbers use
`RFQ-YYYY-NNNNNN`; a PostgreSQL sequence makes allocation unique under concurrency while UUIDs
remain primary keys.

## Lifecycle and snapshots

Task 7 customer transitions are:

```text
DRAFT -> SUBMITTED
DRAFT|SUBMITTED|MATCHING|QUOTING|AWAITING_CUSTOMER -> CANCELLED
```

Only `DRAFT` requests allow changes to fields, items, and attachments. Cancellation is rejected
after an accepted quotation or any order exists, and for statuses outside the list above.
Cancellation accepts `{ "reason": "optional 3–500 character explanation" }`; retrying an
already-cancelled request is harmless. Submitted/cancelled requests are retained, never
hard-deleted.

Submission snapshots the selected vehicle and delivery fields into the request transaction.
Later edits or logical deletion of saved records do not alter request history. `URGENT` and an
optional needed-by time express customer preference only. `serviceAreaEligible` remains unset
until later operational matching; this API does not promise an ETA or eligibility.

## Private photos

Upload the raw file body with `Content-Type: image/jpeg`, `image/png`, or
`application/octet-stream`; optionally send `X-File-Name`. Add `?requestItemId=<uuid>` to attach
the photo to one owned item. The server reads the actual file signature and dimensions rather
than trusting headers or names.

- JPEG and PNG only; SVG and executable/polyglot text are rejected.
- Maximum 5 photos per request, 5 MiB each, 8,000 pixels per dimension, and 40 million pixels.
- Storage keys are generated server-side. Filenames, keys, hashes, and bytes never appear in
  normal JSON responses or logs.
- Files are outside public/static directories and downloads always recheck authorization.
- Removing an item removes its attachment records and attempts private-object cleanup. A failed
  database write also removes the just-written object.

Development uses `REQUEST_ATTACHMENT_DIR=.local/request-attachments`, which is Git-ignored.
Tests inject a temporary isolated adapter. Production startup requires an explicitly injected
durable `RequestAttachmentStorage`; it will not silently use local ephemeral disk. A future
Task 8 adds a separate assignment-scoped supplier authorization path; unassigned suppliers
still have no access.

## Admin read-only endpoints

| Method | Path                                                   | Purpose                                                  |
| ------ | ------------------------------------------------------ | -------------------------------------------------------- |
| GET    | `/admin/requests`                                      | List submitted/non-draft operational requests            |
| GET    | `/admin/requests/:requestId`                           | View an operational request, customer, items and history |
| GET    | `/admin/requests/:requestId/attachments/:attachmentId` | Authorized private photo download                        |

The list supports bounded `page`/`pageSize`, optional `status` (except `DRAFT`), `urgency`,
`createdFrom`, and `createdTo`. Dates are inclusive and `createdTo` cannot precede
`createdFrom`. Drafts are excluded from list, detail, and photo access. These routes do not
match suppliers, expose drafts, or override statuses.

## Migration and verification

Migration `20261018233000_customer_sourcing_requests` adds immutable snapshot JSON, urgency
needed-by time, cancellation reason, optimistic versioning, customer-scoped submission keys,
item category references, attachment dimensions/hashes, integrity checks, and the request-number
sequence. It is additive and does not rewrite prior migrations.

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test
```

Database tests require the dedicated `TEST_DATABASE_URL`; development data is not reset.
