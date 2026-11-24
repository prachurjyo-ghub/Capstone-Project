# Customer catalogue discovery

The customer storefront uses live PostgreSQL catalogue and inventory data. It has no product or
category fallback records.

## Public contracts

- `GET /api/v1/catalogue/categories` lists active admin-owned categories. Categories remain
  visible even when no supplier currently offers a product in that category.
- `GET /api/v1/catalogue/products` lists active products only when at least one active supplier
  business has an eligible subscription and an active, available, in-stock offering.
- `GET /api/v1/catalogue/products/:id` returns the corresponding customer-safe detail.

Search supports product name, description, category, brand and part number. Filters support
`categoryId`, vehicle `make`, `model` and `year`, with bounded `page` and `pageSize` values.

The response uses the shared catalogue product UUID as the public identifier. It never exposes
supplier-business IDs, supplier-user IDs, offering IDs, SKUs, business names or contacts. The
displayed `priceFrom` is the lowest current eligible offering and is informational; a sourcing
quotation remains authoritative. Manufacturer/brand data is not supplier identity.

Category and product images are curated by admins as local raster paths below `/assets`. Supplier
offerings cannot replace public catalogue images or descriptions. This is a practical publication
control against identity leaks; operations must still review descriptions and image content.

## Prototype records

On 2026-10-23 the `autopro_dev` database was manually prepared through domain services, not the
Prisma seed: six categories, three supplier businesses, twelve catalogue products and twelve
inventory offerings. Owner accounts contain no recoverable temporary password. Use the normal
development forgot-password flow and ignored recovery outbox to establish each owner credential.
