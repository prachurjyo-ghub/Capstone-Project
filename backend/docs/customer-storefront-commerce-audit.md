# Customer storefront commerce audit

## Scope and baseline

The customer application already had authenticated custom sourcing, request photos, saved vehicles and addresses, published option acceptance, orders, invoices, messages, and notifications. It did not have a customer-safe supplier-offer read model, a classification filter, a fixed-price purchase action, or a targeted used-parts action. Product cards opened an aggregate catalogue dialog and described every product as quotation-based.

The backend already contained the authoritative commerce mutations:

- `POST /customers/me/purchase-requests` for Genuine and Aftermarket listings.
- `POST /customers/me/requests` with `requestType=USED_PART_RFQ` and a used `listingId`.
- Request submission, quotation publication/acceptance, and customer fulfillment APIs.
- Commission-credit eligibility and reservation in backend services.

No cart, payment collection, or direct checkout service exists, and none was added.

## Implemented read model

Public catalogue list responses now include only aggregate, customer-safe data:

- Available listing classifications.
- Fixed-price floor excluding used listings.
- Whether quote-based used stock exists.
- Offer count and preparation-time floor.

Public product detail responses include current safe offers with listing ID, supplier display name, classification, condition, customer fixed price (or `null` for used), available quantity, availability, preparation time, notes, and the permitted request action.

Offer visibility requires an active product, an active and entitled supplier with an active member, available stock, a classified and published listing, and a non-rejected moderation state. Draft, suspended, archived, rejected, unclassified, inactive, and out-of-stock listings are excluded.

Fixed offers are ordered with commission-credit-ready suppliers first. Eligibility, wallet status, wallet balances, required credits, policy rates, and ranking reasons are never serialized to the customer.

## Implemented customer workflows

### Product discovery

`/parts` supports text, category, vehicle make, Genuine/Aftermarket/Used classification, sorting, and server-backed pagination. Cards distinguish fixed-price availability from used-part quotation availability and link to a stable product detail route.

### Product detail

`/parts/[id]` separates shared product/fitment information from live supplier offers. Customers can filter offers by classification. Fixed offers show the customer price; used offers never present a zero or invented price.

### Fixed-price purchase request

An authenticated customer selects quantity and a saved delivery address. The browser calls the existing purchase-request endpoint with an idempotency key. Backend stock, listing visibility, supplier entitlement, customer address ownership, and credit eligibility remain authoritative. The result is a request pending supplier confirmation, not a completed checkout.

### Used-part RFQ

An authenticated customer selects a used listing, quantity, saved vehicle, saved address, and optional condition/fitment note. The browser creates and submits a targeted `USED_PART_RFQ`. Supplier quotations continue through the existing Admin review and customer option flow.

### Account workflows

My Requests now distinguishes custom sourcing, fixed-price purchases, and used-part RFQs, shows the selected supplier/classification where applicable, routes customers toward quotations or orders, and exposes request cancellation only in backend-supported states. Quotations display the supplier name, conditions, compatibility notes, totals, and delivery estimate. My Orders continues to use existing fulfillment status, history, cancellation, return, and delivery data.

The customer request list API now returns its existing safe detail projection in one query, removing the prior request-detail N+1 calls on dashboard load.

## Preserved behavior

- Custom sourcing, photo attachments, urgent requests, garage lists, and multi-part sourcing are unchanged.
- Existing authentication, CSRF, customer ownership checks, messages, notifications, invoices, order fulfillment, and attachment privacy remain authoritative.
- Existing catalogue/category image paths and fallbacks are reused; no listing-upload storage was invented.
- Supplier cost, margin, commission values, credit balances, contact details, and internal operations notes are not exposed.

## Verification and limitations

Verified during implementation:

- Backend TypeScript, seed TypeScript, and test TypeScript.
- Customer TypeScript and production build, including dynamic `/parts/[id]` output.
- Catalogue/inventory integration tests, including visibility, classification, used quote behavior, safe offer serialization, and private credit-based ranking.

The customer package has no ESLint or browser E2E script, so those checks cannot be honestly run without adding a new toolchain. Cross-portal browser automation is not present. The repository's backend integration suite remains the source of truth for Admin/Supplier/Customer state transitions.

The browser uses server pagination and filtering, but filter state is not yet encoded in the URL. A later navigation refinement can make result pages shareable without changing the API contract.
