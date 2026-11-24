# PartArc customer frontend

Next.js App Router, TypeScript and Tailwind CSS customer frontend migrated from `../legacy-site`. Routes: `/`, `/parts`, `/track`, and `/dashboard`. Dialogs, selects, tabs and loading skeletons use local shadcn/ui components backed by Radix; interface icons use React Icons.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` when the API is not available at the documented local URL,
then open http://localhost:3000. For a production check, run `npm run typecheck` and
`npm run build`, then `npm start`.

The light/dark toggle persists in browser storage. Customer registration, login, logout,
refresh-based reload restoration, password recovery/reset, profile editing, delivery-address
management, and saved-vehicle management use the Express API. Access tokens stay in memory;
the rotating refresh token is an HttpOnly cookie. Requests include credentials, the customer
cookie namespace, and the backend's CSRF header on refresh. Cross-tab refresh is serialized so
normal reloads do not replay a rotated token.

The dashboard and storefront use the live customer, sourcing, quotation, order and public
catalogue APIs. The six category tiles are database-owned records with curated storefront images;
products appear only when an eligible supplier has an active, available offering. Empty API
results remain empty and never fall back to bundled operational records.

See [MIGRATION_MAP.md](MIGRATION_MAP.md) for the source map and omitted legacy files.

Environment variables:

| Variable                       | Default                        | Purpose                                   |
| ------------------------------ | ------------------------------ | ----------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`     | `http://localhost:4000/api/v1` | Express API prefix                        |
| `NEXT_PUBLIC_CSRF_COOKIE_NAME` | `partsarc_csrf`                | Base cookie name; `_customer` is appended |

In development, password-reset links are written to the backend's ignored recovery outbox.
They are never exposed by a public frontend or API endpoint.
