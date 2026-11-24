# Product catalogue and supplier inventory (Task 6)

All paths are below the configured API prefix (normally `/api/v1`). Responses use the
existing `{ success, data, requestId }` envelope. Authentication uses a Task 3 bearer access
token; supplier routes also resolve an active `SupplierUser` membership and an `ACTIVE`
business on every request. When a user belongs to more than one active business, send the
authorized business in `X-Business-Id`.

## Permissions

- `ADMIN` and `SUPER_ADMIN` manage shared categories, brands, products, part numbers,
  compatibility and active status.
- Active `SUPPLIER_OWNER` and `SUPPLIER_STAFF` members can read the supplier catalogue and
  create/update offerings, adjust stock, run bounded bulk updates, and preview/confirm CSV
  imports.
- Only `SUPPLIER_OWNER` can deactivate an offering. Deactivation is soft and preserves stock
  history and references.
- Suppliers cannot write shared catalogue records. Customers have no Task 6 catalogue or
  supplier-inventory endpoints.

## Admin catalogue endpoints

| Method | Endpoint                                                        | Purpose                                        |
| ------ | --------------------------------------------------------------- | ---------------------------------------------- |
| POST   | `/admin/catalogue/categories`                                   | Create a category                              |
| GET    | `/admin/catalogue/categories`                                   | Paginated category list                        |
| GET    | `/admin/catalogue/categories/:id`                               | Category details                               |
| PATCH  | `/admin/catalogue/categories/:id`                               | Update fields or active status                 |
| POST   | `/admin/catalogue/brands`                                       | Create a brand                                 |
| GET    | `/admin/catalogue/brands`                                       | Paginated brand list                           |
| GET    | `/admin/catalogue/brands/:id`                                   | Brand details                                  |
| PATCH  | `/admin/catalogue/brands/:id`                                   | Update fields or active status                 |
| POST   | `/admin/catalogue/products`                                     | Create a standardized product                  |
| GET    | `/admin/catalogue/products`                                     | Search/filter products                         |
| GET    | `/admin/catalogue/products/:id`                                 | Product, numbers and compatibility             |
| PATCH  | `/admin/catalogue/products/:id`                                 | Update product fields or active status         |
| POST   | `/admin/catalogue/products/:productId/numbers`                  | Add an alternate or replace the primary        |
| PATCH  | `/admin/catalogue/products/:productId/numbers/:childId`         | Update a part number                           |
| DELETE | `/admin/catalogue/products/:productId/numbers/:childId`         | Delete an alternate, never the current primary |
| POST   | `/admin/catalogue/products/:productId/compatibilities`          | Add vehicle compatibility                      |
| PATCH  | `/admin/catalogue/products/:productId/compatibilities/:childId` | Update compatibility                           |
| DELETE | `/admin/catalogue/products/:productId/compatibilities/:childId` | Delete compatibility                           |

Lists accept `page` (default `1`), `pageSize` (default `20`, maximum `100`), `search`, and
optional `isActive=true|false`. Product lists also accept `categoryId`, `brandId`, `make`,
`model`, and `year`. Product creation requires at least one part number and exactly one
primary number. Part numbers are normalized to uppercase. A database partial unique index
enforces one primary number per product.

Product activation is separate from category and brand activation. A supplier sees a product
only when the product and its category are active and its optional brand is active. Setting a
record inactive never deletes existing supplier offerings or historical commerce records.

## Supplier catalogue endpoints

| Method | Endpoint                           | Purpose                              |
| ------ | ---------------------------------- | ------------------------------------ |
| GET    | `/supplier/catalogue/products`     | Paginated active catalogue selection |
| GET    | `/supplier/catalogue/products/:id` | Active catalogue product details     |

The list supports the same product search and compatibility filters. Search covers product
name, catalogue code and part numbers. If a required product is missing, the supplier must
contact PartsArc operations with the manufacturer, exact part identifiers and compatibility
evidence. A structured catalogue-request/approval workflow is deferred; suppliers must not
create or modify shared catalogue data themselves.

## Supplier inventory endpoints

| Method | Endpoint                                             | Purpose                                |
| ------ | ---------------------------------------------------- | -------------------------------------- |
| GET    | `/supplier/inventory`                                | Paginated, isolated inventory list     |
| POST   | `/supplier/inventory`                                | Create an offering linked to a product |
| GET    | `/supplier/inventory/:inventoryId`                   | Offering details                       |
| PATCH  | `/supplier/inventory/:inventoryId`                   | Update commercial/availability fields  |
| POST   | `/supplier/inventory/:inventoryId/stock-adjustments` | Apply a signed physical-stock delta    |
| GET    | `/supplier/inventory/:inventoryId/stock-adjustments` | Latest 100 stock-history entries       |
| POST   | `/supplier/inventory/:inventoryId/deactivate`        | Owner-only soft deactivation           |
| POST   | `/supplier/inventory/bulk`                           | Atomic update of 1–100 offerings       |

Creation accepts `productId`, `sku`, decimal-string `unitPrice`, `condition`,
`stockQuantity`, `minimumStock`, `preparationTimeMin`, `isAvailable` and optional `notes`.
`reservedQuantity`, `availabilityStatus`, `businessId` and `version` are server controlled.
Updates intentionally do not accept physical or reserved stock; use the stock-adjustment or
bulk endpoint. Prices are stored as `Decimal(12,2)` and always serialized as two-decimal
strings.

List filters include `search`, `condition`, `availability`, `isActive`, and
`stockState=available|low_stock|out_of_stock`. Search covers supplier SKU, product name and
part number.

### Stock rules

- `availableQuantity = stockQuantity - reservedQuantity`.
- Stock, reserved stock, thresholds and price cannot be negative.
- Physical stock cannot be set below reserved stock. Reserved stock is not accepted by any
  supplier endpoint; later reservation/order workflows own it.
- Manual `isAvailable=false` or offering deactivation yields `HIDDEN`.
- Otherwise zero available quantity yields `OUT_OF_STOCK`; positive available quantity at or
  below the threshold yields `LOW_STOCK`; the remainder is `IN_STOCK`.
- Each delta adjustment requires a nonzero `quantityDelta`, safe `reason`, and supplier-scoped
  `idempotencyKey`. Retrying the exact operation returns the original adjustment without
  applying it again. Reusing the key with different input is a conflict.
- Row locks serialize concurrent changes. `version` is incremented after every offering
  mutation; bulk and CSV confirmation use it to reject stale data.

Bulk input is `{ operationId, items }`. Each item requires `inventoryId` and the last-read
`version`. `stockQuantity` in bulk means an **absolute physical-stock value**, not a delta,
and requires `stockReason`. The entire batch is atomic. Supplier SKU and product/condition
uniqueness are enforced per business.

## CSV preview and confirmation

| Method | Endpoint                           | Purpose                                 |
| ------ | ---------------------------------- | --------------------------------------- |
| GET    | `/supplier/inventory/csv-template` | Download the canonical CSV template     |
| POST   | `/supplier/inventory/csv/preview`  | Validate raw UTF-8 CSV without mutation |
| POST   | `/supplier/inventory/csv/confirm`  | Atomically apply `{ previewId }`        |

Send preview bodies as `text/csv`, `application/csv`, or `application/octet-stream`.
Limits are 512 KiB and 500 data rows. Columns, in exact order, are:

```text
product_id,part_number,sku,condition,unit_price,stock_quantity,minimum_stock,preparation_time_minutes,is_available,notes
```

- Identify a product with `product_id`, an unambiguous exact `part_number`, or both. When both
  are present they must identify the same active product. Ambiguous part numbers are rejected;
  names are never guessed.
- `condition` is `NEW`, `RECONDITIONED`, or `USED`; booleans are `true` or `false`.
- `stock_quantity` is an **absolute physical-stock value**. Confirmation never overwrites
  reserved quantity.
- Duplicate SKUs and duplicate product/condition pairs in one file are row errors. The preview
  reports creates, updates and errors and performs no inventory writes.
- A preview expires after 15 minutes and is bound to the authenticated user and selected
  supplier business. Confirmation refuses previews with errors and rechecks product activity,
  ownership, uniqueness, reserved stock and offering version in one serializable transaction.
- A confirmed preview is idempotent: duplicate confirmation returns the stored result and does
  not reapply it. Any intervening offering change makes an update preview stale.
- CSV never creates categories, brands or products.

## Migration and verification

Migration `20261018230000_catalogue_inventory` adds manual availability/version fields,
database check constraints, the one-primary-number index, append-only stock adjustments and
short-lived CSV preview records. Apply it without resetting data:

```bash
npx prisma migrate deploy
npm run prisma:generate
```
