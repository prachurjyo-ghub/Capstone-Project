# Admin operations frontend

The admin frontend lives in `A_db`, uses port 3002 locally, and consumes the authoritative
`/api/v1` contracts. It does not add or weaken backend permissions. See `A_db/README.md` for the
route/action map, startup steps and explicit UI/contract gaps.

## Core executable workflow

1. Sign in with an `ADMIN` or `SUPER_ADMIN` account at `/login`.
2. Open `/requests`, select a submitted request and review requirements/photos.
3. Select eligible supplier suggestions, set a future deadline and create assignments.
4. Compare submitted quotation revisions; request clarification or reject where justified.
5. Select one offered line per covered request item, enter explicit BDT margin/delivery/priority
   charges and a validity deadline. The returned preview is server-calculated.
6. Publish the immutable option. After the customer accepts it, reopen the request preview and
   convert its acceptance to an order with an idempotency key.
7. Use `/orders/[id]` to inspect reservations, record allowed fulfillment transitions and issue an
   invoice, external customer receipt record and supplier payable when eligible.

The acceptance-to-order button appears only when the loaded option response includes an acceptance.
Expired, stale, inactive-supplier and insufficient-stock responses are shown from the API with the
request ID and never converted into optimistic success.

## Supplier access operations

The redesigned overview uses real date-bounded request/order volume, a compact subscription-aware
KPI strip, a unified oldest-first attention table and recent business mutations without routine
login/refresh noise. `/subscriptions` manages plans, periods and separate supplier-subscription
billing. Supplier detail separates business, individual account and entitlement status, supports
temporary-password owner onboarding, and shows member/billing/audit history. `/catalogue` includes
category-request decisions and product child editing. Settlement allocations, case history,
message attachment upload, invoice voids, transaction reversals and refund completion are connected
to their existing or minimal authorized contracts.

## Security and privacy

- Access tokens are memory-only. Refresh cookies are HttpOnly and namespaced to the `admin` client;
  the readable CSRF cookie is echoed only on refresh. Refresh rotation is coordinated across tabs.
- A redirect after login must be an internal absolute path. Customer and supplier roles are logged
  out instead of being admitted to the shell.
- Customer contact/delivery details, financial references and message contents are never written to
  browser logs by application code. Downloads require a current bearer-authenticated request.
- Exact addresses remain operations-only. Supplier views continue to use the backend privacy
  serializers; hiding a button is not authorization.
- Financial posting and lifecycle controls require review confirmation where consequential. The UI
  uses API totals and immutable snapshots and does not infer payment, refund or payout execution.

## Staging gate

Run the `A_db` test/typecheck/lint/format/build commands, then use isolated records to check ADMIN and
SUPER_ADMIN login, wrong-role denial, refresh/reload/multi-tab behavior, deep links, assignment,
publication, order conversion, fulfillment, invoice/payment/payable recording, error conflicts,
mobile navigation and light/dark/system themes. Browser verification is not satisfied by a build.
