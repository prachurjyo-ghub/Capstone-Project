# PartsArc Database Design (Task 2)

PostgreSQL schema for the shared PartsArc Express backend used by the customer website, supplier portal, and admin/operations portal.

This document describes the Prisma models introduced in Task 2. No live database connection is required to review or validate this design.

## Core workflow

```text
Customer requirement
  → Supplier matching / assignment
  → Supplier quotations
  → Admin review
  → Customer quotation approval
  → Order confirmation
  → Supplier preparation
  → Pickup / delivery
  → Completion + settlement
```

## Mermaid ER diagram (primary relationships)

Secondary authentication tokens and status-history tables are grouped rather than fully expanded.

```mermaid
erDiagram
  User ||--o| CustomerProfile : has
  User ||--o{ SupplierUser : membership
  SupplierBusiness ||--o{ SupplierUser : employs
  SupplierBusiness ||--o{ SupplierLocation : has
  SupplierBusiness ||--o{ SupplierInventory : stocks
  Product ||--o{ SupplierInventory : offered_as
  Product }o--|| PartCategory : categorized
  Product }o--o| Brand : branded
  Product ||--o{ ProductNumber : aliases
  Product ||--o{ ProductCompatibility : fits

  CustomerProfile ||--o{ Vehicle : owns
  CustomerProfile ||--o{ CustomerAddress : has
  CustomerProfile ||--o{ SourcingRequest : submits
  SourcingRequest ||--o{ SourcingRequestItem : contains
  SourcingRequest ||--o{ SupplierRequestAssignment : assigned_to
  SupplierBusiness ||--o{ SupplierRequestAssignment : receives
  SourcingRequest ||--o{ Quotation : receives
  SupplierBusiness ||--o{ Quotation : submits
  Quotation ||--o{ QuotationItem : lines
  Quotation ||--o{ Order : may_create
  Order ||--o{ OrderItem : lines
  Order ||--o| Delivery : fulfilled_by
  Order ||--o{ Invoice : billed_as
  Order ||--o{ Transaction : recorded_in
  SupplierBusiness ||--o{ SupplierSettlement : paid_via

  Conversation }o--o| SourcingRequest : about
  Conversation }o--o| Quotation : about
  Conversation }o--o| Order : about
  Conversation ||--o{ Message : contains
  User ||--o{ Notification : receives
  User ||--o{ AuditLog : acts

  AUTH_TOKENS["RefreshSession / PasswordResetToken / VerificationToken / AccountInvitation"] }o--|| User : secured_by
  HISTORY["Request / Quotation / Fulfillment / Delivery status history"] }o--|| CORE["SourcingRequest / Quotation / Order / Delivery"] : append_only
```

## Model groups

### Identity and access

| Model                | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `User`               | Shared identity for customer, supplier and admin actors |
| `CustomerProfile`    | Customer-specific profile linked 1:1 to `User`          |
| `SupplierBusiness`   | Legal/operating supplier entity                         |
| `SupplierUser`       | Membership of a user in a supplier business             |
| `SupplierLocation`   | Warehouses / counters                                   |
| `AccountInvitation`  | Admin-created invitations for supplier/admin accounts   |
| `RefreshSession`     | Hashed rotating refresh/CSRF tokens and device families |
| `PasswordResetToken` | Hashed password-reset tokens                            |
| `VerificationToken`  | Hashed email/phone verification tokens                  |

Roles supported on `User.role`:

- `CUSTOMER`
- `SUPPLIER_OWNER`
- `SUPPLIER_STAFF`
- `ADMIN`
- `SUPER_ADMIN`

Customers may register independently. Task 4 provisions initial supplier owners through
admin-created, hashed-token invitations. Staff invitations remain deferred.

### Catalogue vs inventory

- `Product` is the shared catalogue entry.
- `ProductNumber` stores primary and alternate part numbers.
- `ProductCompatibility` stores vehicle fitment hints.
- `SupplierInventory` is supplier-specific stock, price, condition and availability.
- `InventoryStockAdjustment` is append-only physical-stock history with supplier-scoped
  idempotency keys.
- `InventoryCsvPreview` binds validated import rows to a supplier/user until atomic
  confirmation or expiry.

These entities are intentionally separate so multiple suppliers can stock the same catalogue product with different prices and quantities.

### Sourcing and quotations

- Multi-part garage requests are modeled as one `SourcingRequest` with many `SourcingRequestItem` rows.
- Task 7 snapshots submitted vehicle/delivery details as JSON so later saved-record edits cannot
  rewrite history. Customer-scoped submission keys make submission retries idempotent.
- Private JPEG/PNG metadata is stored in `RequestAttachment`; bytes remain behind an injected
  authorized storage adapter.
- Matching is recorded in `SupplierRequestAssignment` (`ASSIGNED`, `VIEWED`, `SKIPPED`, `QUOTED`, `EXPIRED`, `WITHDRAWN`).
- Task 8 records assignment transitions/deadline changes in append-only
  `SupplierAssignmentHistory` rows and stores focused supplier/operations questions in
  `SupplierClarification` without activating the general messaging module.
- Quotes preserve supplier economics (`supplierSubtotal`, item `supplierUnitPrice`) separately from customer-facing totals (`customerTotal`, item customer prices, `adminMargin`, delivery/priority charges).
- Revisions use `revisionGroupId` + `revisionNumber` and optional `supersedesId` so prior quote versions remain intact.

### Orders, delivery and finance

- Accepted quotations eventually create `Order` + `OrderItem` records (service layer in a later task).
- Fulfillment transitions are append-only in `FulfillmentStatusHistory`.
- `Delivery` / `DeliveryStatusHistory` track courier movement.
- `Transaction` distinguishes payment vs payable vs margin vs charges vs refunds via `TransactionType`.
- `Invoice`, `SupplierSettlement` and `Refund` keep customer billing and supplier payouts distinct.

### Communication and operations

- `Conversation` can link to a request, quotation or order.
- Unread state is derived from `ConversationParticipant.lastReadAt` and `Notification.isRead`.
- `AuditLog` stores actor, action, entity, safe metadata, timestamp and request ID. Secrets and raw auth tokens must never be stored in metadata.

## Important enums

| Enum                                                                    | Why it exists                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `AccountStatus`                                                         | Soft account lifecycle without deleting users                |
| `SupplierBusinessStatus`                                                | Business enablement separate from user login                 |
| `InventoryAvailability`                                                 | Matching/search without recalculating stock rules every time |
| `RequestUrgency` / `SourcingRequestStatus`                              | Customer request workflow                                    |
| `SupplierAssignmentStatus`                                              | Supplier inbox state machine                                 |
| `QuotationStatus` / `AdminReviewStatus`                                 | Supplier submission + admin gate                             |
| `OrderStatus` / `DeliveryStatus`                                        | Fulfillment and logistics                                    |
| `PaymentStatus` / `SettlementStatus` / `RefundStatus` / `InvoiceStatus` | Financial lifecycle without a payment gateway                |
| `TransactionType`                                                       | Separates money flows in the ledger                          |

## Deletion and historical-data rules

1. **Users and businesses are soft-controlled** via status / `disabledAt` / `closedAt` rather than hard deletion of historical commerce data.
2. **Restrict** is used for relations from historical commerce entities (`Order`, `Quotation`, `Transaction`, `Invoice`, `AuditLog` actors) back to users/businesses so disabling an account does not erase money or fulfillment history.
3. **Cascade** is limited to owned child rows that have no independent audit value outside their parent (for example quotation items under a quotation, message attachments under a message).
4. Tokens and sessions may cascade with the user because they are ephemeral security artifacts.
5. Catalogue products support `deletedAt` / `isActive` so inventory and order lines can still reference the product snapshot fields on line items.
6. Quotation revisions are retained (`SUPERSEDED`) rather than overwritten.
7. Saved customer addresses and vehicles use `isActive` plus `deletedAt`. Customer APIs hide
   deleted rows, while sourcing-request and order foreign keys remain intact for history.

## Public identifiers

UUID primary keys remain the internal identifiers. Unique public fields are reserved for human-readable references:

- `SourcingRequest.requestNumber`
- `Quotation.quotationNumber`
- `Order.orderNumber`
- `Invoice.invoiceNumber`
- `Transaction.reference`
- `SupplierBusiness.businessCode` (optional)
- `Product.catalogueCode` (optional)

Task 7 allocates `SourcingRequest.requestNumber` from a PostgreSQL sequence and formats it as
`RFQ-YYYY-NNNNNN`, preserving the UUID primary key. Later services will define the other public
identifier generators.

## Indexes (high-value query paths)

- Customer request history: `(customerId, createdAt)` on requests/orders/invoices
- Supplier inbox: `(businessId, status, assignedAt)` on assignments
- Open urgent requests: `(status, urgency, createdAt)` and `(urgency, status)`
- Quotes by request/supplier: `(requestId, status)`, `(businessId, status, createdAt)`
- Inventory search: unique `(businessId, sku)`, `(businessId, availabilityStatus)`, `(productId, availabilityStatus)`
- Inventory integrity: database checks keep price/stock/thresholds nonnegative and reserved
  stock within physical stock; one partial unique index allows one primary part number per
  catalogue product.
- Unread notifications: `(userId, isRead, createdAt)`
- Conversation recency: `(conversationId, sentAt)`, `(lastMessageAt)`
- Audit investigation: `(entityType, entityId, createdAt)`, `(requestId)`
- Supplier ownership: partial unique indexes enforce one current primary membership and one
  pending owner invitation per business. These PostgreSQL indexes are defined in the Task 4
  SQL migration because Prisma schema syntax cannot express partial indexes.
- Customer defaults: a Task 5 partial unique index allows at most one active, non-deleted
  default address per customer. Customer-row locking serializes competing default changes.

## Notes for the future service layer

1. Keep all database access on the shared Prisma client singleton.
2. Generate public numbers in services (for example yearly counters or prefixed sequences) inside transactions.
3. Hash passwords and all auth tokens before persistence.
4. Creating an order from an accepted quotation should copy supplier vs customer pricing into immutable order lines.
5. Stock reservation should update `SupplierInventory.reservedQuantity` when an order is confirmed.
6. Keep development seeds illustrative and avoid using them as production identities.
7. Apply new migrations with `npx prisma migrate deploy`; never rewrite applied migrations.

## Offline migration preparation

Initial SQL was generated with:

```bash
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script \
  --output prisma/migrations/20261016190000_init/migration.sql
```

Local development applies this migration with:

```bash
npm run db:migrate
```

Prefer Docker Compose (`../compose.yaml`, host port `5433`) when Docker is available. Otherwise use a dedicated local `autopro_dev` database. Neon/hosted Postgres will be configured later for demos.
