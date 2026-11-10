# B1 — Skeleton: shop, fixed-price PayPal payment, receipt from PayPal, failure path

Features: F5 (basic), F6, F9, part of F10. Architecture: `docs/ARCHITECTURE.md` §3.1, §3.5, §3.8. Verified PayPal behaviour: `docs/FACTS.md` (bottom table) and `docs/EVIDENCE.md`.
**Next.js 16 has breaking changes**: before writing route handlers, pages, or `params`, read the relevant guide in `node_modules/next/dist/docs/01-app/` (route handlers, dynamic route params are a Promise, server/client components).

## Goal
A buyer opens `/`, sees one product ("Earned Price demo licence", $49.00), pays with the PayPal button in the **sandbox**, and lands on `/receipt/<orderId>` which shows the payment **as PayPal recorded it** plus a licence key. Cancelling or failing shows a clear message and no licence. In B1 every buyer is a guest: price = list = 4900 cents, no discount, no rule, no redemption. The data model and state machine are the final ones (§3.5) so B3 only adds rules and redemptions.

## Out of scope (later features)
Rules/evaluation in the quote (B2/B3), GitHub sign-in and samples (B2), redemptions and judge reset (B3), refunds and claim (B5), merchant page (B4), deploy and keep-alive pinger (B6). Do not build them; do not stub UI for them.

## Files
Already exist, reuse, do not rewrite: `src/paypal/client.ts` (`paypal(method, path, {body, requestId, representation})`, `assertSandbox()`), `src/paypal/money.ts` (`toPayPalValue`, `fromPayPalValue`), `src/facts/snapshot.ts` (`canonicalJson`, `snapshotHash`), `src/facts/types.ts` (`GuestSnapshot`).

### Backend (author A)
- `db/schema.sql` — all four tables exactly as §3.5 (rules, orders, redemptions, refunds + partial unique index), `create table if not exists`, idempotent. Add `create index if not exists orders_session_idx on orders(session_id)`.
- `scripts/db-migrate.mts` — applies `db/schema.sql` using `DATABASE_URL_DIRECT`. Update `package.json` `db:migrate` to `tsx --env-file=.env scripts/db-migrate.mts`.
- `src/store/db.ts` — `pg.Pool({ connectionString: DATABASE_URL, max: 3, idleTimeoutMillis: 10_000 })`, `pool.on('error', ...)` logs, one retry on connection-reset errors (`ECONNRESET`, `57P01`, `Connection terminated`). Export `query(text, params)` and `tx(fn)` (BEGIN/COMMIT/ROLLBACK). Append `sslmode=verify-full` handling so pg's SSL warning goes away.
- `src/session.ts` — `iron-session` cookie `ep_session`, password `SESSION_SECRET`, `httpOnly`, `secure` in production, `sameSite: 'lax'`; type `{ sid: string; hasOrders?: boolean }`; `getSession()` creates `sid = randomUUID()` when absent.
- `src/store/capture-outcome.ts` — **pure** `decideCaptureOutcome(input) → Decision` implementing the §3.5 capture outcome table (see contract below). Fully unit-tested.
- `src/store/orders.ts` — `createGuestQuote(sid)`, `createPayPalOrder(orderId, sid)`, `capture(paypalOrderId, sid)`, `cancel(orderId, sid)`, `listForSession(sid)`, `reconcileOrder(orderId)` (only the rows of §3.5's reconcile table that apply to `created | approved | capturing` — refund rows come in B5). Every state change is compare-and-set (`UPDATE … WHERE id=$1 AND state=$expected RETURNING`); no row lock is held across a PayPal call; PayPal calls have the client's 10 s timeout.
- `src/licence.ts` — `licenceKey(captureId) = "EP-" + base32(hmac_sha256(LICENSE_HMAC_SECRET, captureId)).slice(0, 20)` (RFC 4648 alphabet, no padding).
- `src/instrumentation.ts` (Next.js instrumentation hook, Node runtime) — calls `assertSandbox()`; on failure logs and `process.exit(1)`.
- Route handlers (all `POST` routes check `Origin` equals `APP_URL`, else 403):
  - `GET  /api/health` → `200 {"ok":true}`; **never touches the DB**.
  - `POST /api/quote` → creates a guest order: `snapshot = {version:1, kind:"guest", fetchedAt}`, `snapshot_json = canonicalJson(snapshot)`, `snapshot_hash = snapshotHash(snapshot)`, `list_cents = earned_cents = 4900`, `discount_cents = 0`, `state='quoted'`, `expires_at = now()+15 min`, `session_id = sid`, `rule_id/rule_version` null; sets `session.hasOrders = true`. Response `200 {orderId, listCents, earnedCents, discountCents, lines: []}`.
  - `POST /api/paypal/create` body `{orderId}` → per §3.5 Create (minus redemptions): returns `200 {paypalOrderId}`. Any body key other than `orderId` → `400 {error: "prices are computed server-side"}`. No `discount` key in the breakdown when discount is 0. One item `{name:"Earned Price demo licence", quantity:"1", unit_amount: list}`, `custom_id = "<orderId>:<snapshotHash>"`, `invoice_id = orderId`, `PayPal-Request-Id = "o-" + orderId without hyphens`. Refuses (`409 {error, state}`) if not `quoted`, expired, or another session's order. Refuses `earned_cents < 1` (`422`).
  - `POST /api/paypal/capture` body `{paypalOrderId}` → §3.5 Capture steps 1–3 using `decideCaptureOutcome`; response `200 {state, orderId, restart?: true, message?: string}`. Capture `PayPal-Request-Id = "c-" + hex32 + "-" + attempt`.
  - `POST /api/orders/[id]/cancel` → `cancelled` only from `quoted|created|approved` of this session; `200 {state}`.
  - `GET  /api/orders/mine` → this session's orders `[{orderId, state, earnedCents, createdAt}]`, newest first, max 10; reconciles non-terminal ones first. Only called by the client when the session has `hasOrders`.

### Frontend (author B)
- `src/app/layout.tsx` — title "Earned Price", plain system font stack is fine; light/dark via Tailwind.
- `src/app/page.tsx` + `src/app/shop-client.tsx` (client component) — product card: name, one-line pitch ("A checkout where the price is earned from verified public facts — no coupon codes."), list price **$49.00**, a "Buy for $49.00" flow: on mount nothing; on click "Get price" → `POST /api/quote` → show the price and render `PayPalButtons` (`@paypal/react-paypal-js`, `clientId = NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `currency: "USD"`, `intent: "capture"`) with `createOrder` → `POST /api/paypal/create {orderId}` → return `paypalOrderId`; `onApprove({orderID})` → `POST /api/paypal/capture` → if `restart` call `actions.restart()`; else `router.push('/receipt/' + orderId)`; `onCancel` → `POST /api/orders/{orderId}/cancel` and show "Payment cancelled — you were not charged and no licence was issued."; `onError` → show "Payment failed — you were not charged and no licence was issued." plus the error message. Prices shown on this page are labelled "price quote" (they come from our server; the receipt shows PayPal's figures).
- Judge mode (`process.env.JUDGE_MODE === "1"`, read in the server component and passed as a prop): a box "Sandbox buyer for judges" with `JUDGE_BUYER_EMAIL` and `JUDGE_BUYER_PASSWORD` (copy buttons), and the note "PayPal sandbox — no real money. You can also pay with the test card 4111 1111 1111 1111, any future expiry, CVV 123." A three-step strip "How it works": 1 Prove (public GitHub facts) · 2 Price (code computes the discount) · 3 Pay (PayPal charges exactly that; the receipt is read back from PayPal).
- "Your orders" list: rendered only if the server component sees `session.hasOrders`; client fetches `/api/orders/mine`; each row links to its receipt.
- `src/app/receipt/[id]/page.tsx` (server component) — loads the order for this session (404 otherwise), calls `reconcileOrder`, then `GET /v2/checkout/orders/{paypalOrderId}` and renders **only PayPal's values**: order status, `amount.value`, `breakdown.item_total`, `breakdown.discount` (or "none"), capture id, capture status, capture amount, PayPal fee, `custom_id`. Hash check: split `custom_id` at the first `:`, compare with `sha256(snapshot_json)` recomputed by code → green "Fact hash verified" or red "Fact hash MISMATCH — no licence". Licence key shown only when state is `captured` **and** the hash verified. State-specific copy: `capturing` → "Payment is processing at PayPal — refresh in a few seconds"; `failed|cancelled|expired` → clear message, no licence; `mismatch` → red "Amount mismatch — no licence". If the PayPal GET fails → "PayPal is unavailable right now — retry" and **no DB money figures**. Every money figure has a small label "as recorded by PayPal".
- Accessible basics: buttons are `<button>`, visible focus, colour not the only signal (icons/text for verified/mismatch), works at 375 px width.

## Contract: `decideCaptureOutcome`
```ts
type CaptureInput =
  | { kind: "response"; httpStatus: number; body: any }   // what paypal() returned for POST .../capture
  | { kind: "network_error" };                             // timeout / fetch threw
type Decision = {
  nextState: "captured" | "mismatch" | "capturing" | "failed" | "approved" | "created";
  capture?: { id: string; status: string; amountCents?: number; currency?: string; feeCents?: number; reason?: string };
  releaseRedemption: boolean;   // false for B1 callers to ignore, but computed
  issueLicence: boolean;
  clientAction?: "restart";
  message: string;
};
decideCaptureOutcome(input: CaptureInput, earnedCents: number): Decision
```
Rules (from §3.5, verified facts P18/P21/P23): 2xx with `purchase_units[0].payments.captures[0]`:
`COMPLETED` & USD & amount == earned → `captured`, licence; `COMPLETED` otherwise → `mismatch`, no licence, keep redemption; `PENDING` → `capturing`, store id + `status_details.reason`, keep redemption; `DECLINED`/`FAILED` → `failed`, release. 422 with issue `INSTRUMENT_DECLINED` → `approved` + `clientAction:"restart"`, release; `ORDER_NOT_APPROVED` → `created`, release; `ORDER_ALREADY_CAPTURED`, any other 4xx/5xx, 429, malformed body, `network_error` → `capturing`, keep redemption (reconcile decides). Amounts parsed only with `fromPayPalValue`.

## Acceptance checks
1. `pnpm db:migrate` succeeds twice in a row against Neon (idempotent).
2. `pnpm test`, `pnpm typecheck`, `pnpm lint` pass; `decideCaptureOutcome` has a test per row above.
3. `GET /api/health` returns 200 with no DB connection (test by unsetting `DATABASE_URL`).
4. Local end to end in the sandbox (run by the integrator, recorded in `docs/EVIDENCE.md`): pay $49.00 with the sandbox test card in the PayPal card form → receipt shows PayPal's amount 49.00, capture COMPLETED, hash verified, licence key; cancel path shows the cancel message and no licence.
5. Sending `{orderId, amount: 1}` to `/api/paypal/create` returns 400 "prices are computed server-side".
6. A POST without the right `Origin` returns 403.
