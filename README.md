# Parts Ark Capstone Project

Parts Ark coordinates automotive-parts sourcing across a customer storefront, a supplier portal, and an admin workspace. This university edition runs locally with one API and one PostgreSQL database. Part 1 contains the API and storefront. Part 2 adds the two operational portals through the [teammate handoff](README-TEAMMATE.md).

## Requirements

- Node.js 22.23.2 and npm
- Docker with Docker Compose, or local PostgreSQL 17 and Redis 8
- A browser and Git

Install dependencies from the lockfile in each app directory with `npm ci`.

## Start the database, cache, and API

From the repository root:

```sh
docker compose up -d --wait
cd backend
npm ci
cp .env.example .env
```

The Compose project uses its own database and volumes. PostgreSQL is exposed on loopback port `5433` and Redis on `6380`. If you run the services directly, create an empty database and user with permission to run the migrations. Set both `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to that local database and set `REDIS_URL` to your local Redis instance.

Generate two independent values with `openssl rand -hex 48` and set them as `ACCESS_TOKEN_SECRET` and `TOKEN_HASH_SECRET` in `backend/.env`. Keep the file local. Keep `NODE_ENV=development`, `ATTACHMENT_STORAGE_PROVIDER=local`, and `EMAIL_DELIVERY_PROVIDER=local`. Use `localhost` consistently in portal and API URLs so authentication origins and cookies match.

Run these commands from `backend`:

```sh
npm run db:migrate
npm run db:generate
npm run dev
```

In a second terminal, also from `backend`, run `npm run worker:dev`. Verify the API, database, Redis and worker at `http://localhost:4000/api/v1/health/readiness`.

## Start the portals

Each portal runs in its own terminal. Copy its `.env.example` to `.env.local` and leave `NEXT_PUBLIC_API_BASE_URL` set to `http://localhost:4000/api/v1`.

| Portal | Directory | Start command | Local URL |
| --- | --- | --- | --- |
| Customer | `C_frontend` | `npm run dev -- -H localhost` | `http://localhost:3000` |
| Supplier | `S_db` | `npm run dev -- -H localhost -p 3001` | `http://localhost:3001` |
| Admin | `A_db` | `npm run dev -- -H localhost` | `http://localhost:3002` |
| Garage owner and mechanic | `G_db` | `npm run dev -- -H localhost` | `http://localhost:3003/login` |

## Accounts and assets

The migrations initialize the schema. Create demonstration data later through the application. You can register a customer immediately. To provision the first admin from `backend`, supply a local `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` through your shell environment and run `node --env-file=.env --import tsx scripts/provision-admin.ts`. Use a password of at least 12 characters containing uppercase, lowercase, and a number. After Part 2, sign in to the admin portal to onboard a supplier and create catalogue data.

- Keep storefront assets under [`C_frontend/public/assets`](C_frontend/public/assets). The app serves them at `/assets/...`, which is the format accepted by catalogue image fields. The storefront retains the existing asset credits.
- Customer photos and message attachments are stored in `backend/.local/request-attachments`. Supplier listing uploads use `backend/.local/request-attachments-listing-images`. Use the portal upload flows so the API maintains access rules and image approval.
- Password reset and invitation links are written to `backend/.local/recovery-outbox`. The worker writes local notification deliveries to `backend/.local/notification-outbox`. Use test addresses such as `customer@example.test`.

### Garage inspection

Admin creates the garage and owner under **Garages**. Share the temporary password privately. The owner signs in to `G_db`, changes the password, completes the public profile and creates mechanic accounts. Customers use **Garages** to search and **Garage Reports** on their account dashboard for reports shared with them. The owner must enter an existing customer's account email when creating a job.

Inspection media is stored privately in `backend/.local/request-attachments-garage-evidence` by default. Customers can download specific files after the owner shares them in response to a request. Keep this directory with the local database if you need to restore reports with their original evidence. See [Garage inspection workflow](docs/garage-inspection.md).

## Verify and stop

Run `npm run build` and `npm run typecheck` in the API and each available portal. Check the customer landing page and bundled media, catalogue empty state, registration, sign-in, and submission of a request with a photo. The [handoff guide](README-TEAMMATE.md) covers full cross-portal acceptance after Part 2.

For API integration tests, create and migrate a separate empty test database. For the default Compose configuration, run the following from the repository root, then enter `backend`:

```sh
docker compose exec postgres createdb -U capstone partsark_capstone_test
cd backend
DATABASE_URL='postgresql://capstone:capstone_local_db@localhost:5433/partsark_capstone_test?schema=public' npx prisma migrate deploy
npm test
```

The test runner uses `TEST_DATABASE_URL` from `backend/.env`. Keep the test database distinct from your demo database. Stop the app processes with Ctrl+C and run `docker compose down` from the root to stop the services and retain their volumes.

## Source and contributions

The existing Parts Ark UI, business logic, migrations, tests, and bundled media were imported from revision `b6b9154`. The Capstone changes cover source packaging, local configuration, portal integration, and a Next.js 16.4.6 patch update for the university portal builds. Prachurjyo owns the shared local foundation and customer deliverable. Fardin owns the supplier and admin integration and end-to-end acceptance. Record the changes and checks each person actually completes in their pull requests.
