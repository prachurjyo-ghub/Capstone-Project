# Authentication and role permissions

Task 3 uses email/password login. Public registration can create only a `CUSTOMER` user and
its `CustomerProfile` in one transaction. New customers have
`PENDING_VERIFICATION` status and `emailVerified: false`; they may authenticate, but the API
does not claim that email or phone ownership has been verified.

All routes below are mounted under `API_PREFIX` (locally `/api/v1`). Responses retain the
standard `{ success, data|error, requestId }` envelope.

## Endpoint contracts

| Method | Path                    | Request                                                   | Result                                                     |
| ------ | ----------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| POST   | `/auth/register`        | `{ email, password, fullName, preferredName?, phone? }`   | `201`, access token, CSRF token, safe account, and cookies |
| POST   | `/auth/login`           | `{ email, password }`                                     | Access token, CSRF token, safe account, and cookies        |
| POST   | `/auth/refresh`         | Refresh cookie, CSRF cookie, `Origin`, and `X-CSRF-Token` | Rotated access/refresh/CSRF tokens                         |
| POST   | `/auth/logout`          | `Authorization: Bearer <access-token>`                    | Revokes the current device session family                  |
| POST   | `/auth/logout-all`      | `Authorization: Bearer <access-token>`                    | Revokes all user sessions                                  |
| GET    | `/auth/me`              | `Authorization: Bearer <access-token>`                    | Safe current-account data                                  |
| POST   | `/auth/forgot-password` | `{ email }`                                               | Always the same generic acknowledgement                    |
| POST   | `/auth/reset-password`  | `{ token, newPassword }`                                  | Consumes the token and revokes all sessions                |
| GET    | `/auth/access/admin`    | Bearer token                                              | Small Task 3 admin-role middleware probe                   |
| GET    | `/auth/access/supplier` | Bearer token and optional `X-Business-Id`                 | Small Task 3 supplier membership probe                     |

Passwords must be 12–128 characters and include upper-case, lower-case, and numeric
characters. Phone numbers, when supplied, use E.164 form such as `+8801700000000`.
Registration rejects additional fields, including role, status, membership, and verification
fields.

Access tokens use HS256 with configured issuer, audience, issued-at, and expiration checks.
They are returned in response bodies and should be kept in frontend memory, then sent in the
`Authorization` header. Refresh tokens are random opaque values and are never returned in a
body or URL. Only keyed hashes are stored. Rotation is atomic; using a rotated token revokes
the affected device family. A user may have multiple independent device families.

Every protected request reloads the session and user from PostgreSQL. Consequently, hard
deletion, suspension, disabling, logout, and password-reset revocation take effect without
waiting for access-token expiry. Supplier routes additionally require a current active
membership in an `ACTIVE` business. A supplied business ID is matched against database
membership and never grants access by itself.

## Cookies, CORS, and CSRF

The refresh cookie is `HttpOnly`, scoped to `${API_PREFIX}/auth`, and configured with
`Secure` and `SameSite` from the environment. The non-HttpOnly CSRF cookie is scoped to `/`.
Refresh requests require all of the following:

1. An exact `Origin` match in `CLIENT_ORIGINS`.
2. The CSRF cookie value repeated in `X-CSRF-Token`.
3. A hash match between that CSRF token and the current database session.

For the three local frontends, keep their exact origins in `CLIENT_ORIGINS`, use
`COOKIE_SECURE=false` and `COOKIE_SAME_SITE=lax`, and send requests with credentials enabled.
Each frontend sends `X-Auth-Client: customer`, `supplier`, or `admin` on every authentication
request. The backend then suffixes both configured cookie names with that client, for example
`partsarc_refresh_customer` and `partsarc_csrf_supplier`. The header is deliberately restricted
to those three values. Requests without it retain the unsuffixed Task 3 cookie names for
backward compatibility with existing API clients.

The namespace is required because cookies are scoped by host and path, not port: without it,
opening customer and supplier apps on different localhost ports would overwrite the same
rotating refresh token and could trigger session-family replay protection. The frontend reads
its own namespaced CSRF cookie and repeats it in `X-CSRF-Token` on refresh. `X-Auth-Client`
selects a cookie namespace only; it never grants a role or bypasses database authorization.

Production must use HTTPS and `COOKIE_SECURE=true`. Prefer routing API calls through a
same-site application/API domain with host-only cookies. If the frontends and API are truly
cross-site, use `COOKIE_SAME_SITE=none`, retain exact origin allowlisting and CSRF headers,
and assess whether a narrowly scoped `COOKIE_DOMAIN` or a same-origin backend proxy is safer.
Never use wildcard credentialed CORS. Any configured cookie domain must be trusted by all
subdomains that can read the CSRF cookie.

## Environment variables

| Variable                                             | Purpose                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `ACCESS_TOKEN_SECRET`                                | Independent random signing secret, minimum 32 characters     |
| `TOKEN_HASH_SECRET`                                  | Independent HMAC secret for opaque-token hashes              |
| `JWT_ISSUER`, `JWT_AUDIENCE`                         | Required access-token identity constraints                   |
| `ACCESS_TOKEN_TTL_SECONDS`                           | Access lifetime, 60–3600 seconds                             |
| `REFRESH_TOKEN_TTL_DAYS`                             | Absolute device-family lifetime, 1–90 days                   |
| `PASSWORD_RESET_TTL_MINUTES`                         | Reset-token lifetime, 5–120 minutes                          |
| `REFRESH_COOKIE_NAME`, `CSRF_COOKIE_NAME`            | Cookie names                                                 |
| `COOKIE_SECURE`, `COOKIE_SAME_SITE`, `COOKIE_DOMAIN` | Cookie deployment policy                                     |
| `PASSWORD_RESET_URL_BASE`                            | Frontend URL used to construct reset links                   |
| `RECOVERY_OUTBOX_DIR`                                | Ignored development-only local outbox                        |
| `RATE_LIMIT_ENABLED`                                 | Enables endpoint rate limits; disable only in isolated tests |
| `TEST_DATABASE_URL`                                  | Dedicated PostgreSQL integration-test database               |

Generate independent secrets with a cryptographic generator such as
`openssl rand -hex 48`. Never copy development secrets to production or reuse one secret for
both settings.

## Local password recovery

Development writes one mode-0600 JSON message per reset request to
`.local/recovery-outbox/`. The message contains the reset URL and is intentionally ignored by
Git. Raw tokens are not logged or returned by the API. Inspect the newest local file to test
the reset flow, then submit its URL token to `/auth/reset-password`.

Production uses no local fallback. Inject a real `RecoveryDelivery` implementation before
launch; until then, production forgot-password responses remain generic but no email is sent.
The verification-token service is persistence preparation only—no verification endpoint or
ownership claim exists yet.

## Commands

```bash
npm run prisma:validate
npm run prisma:generate
npm run db:migrate
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

`npm test` refuses to run database tests without `TEST_DATABASE_URL`. Never point it at the
development or production database; the integration suite deletes its own test fixtures.
