# ARCHITECTURE — Earned Price

_Frozen Nov 9 2026 after architecture loop L2 (two rounds, cap reached: Gemini 3.8 Flash + Fable round 1, fresh Fable round 2; every finding fixed in place, see the L2 log at the end). Facts referenced as P#/G#/H# are rows in [FACTS.md](FACTS.md). Any change after the freeze gets a one-line reason in "Changes after freeze" below._

## 3. Architecture v2 (frozen Nov 9)

Known candidate for a post-freeze change: if proof P1 shows the discount line does not come back on GET, 3.5 switches to "charge net; discount in `custom_id` + receipt" with a note below.

### 3.1 Stack
- Next.js 16 (current 16.4.x) App Router, TypeScript strict, Node runtime for every route. pnpm. Vitest 5, zod 4, `pg` 8, `iron-session` 9, `@paypal/react-paypal-js` 10, `@anthropic-ai/sdk` 1.x (versions checked Nov 9). ESLint. `tsc --noEmit`.
- DB: Postgres on **Neon** free via `pg` (pooled URL at runtime, direct URL for `pnpm db:migrate`, H18). `pg.Pool({ max: 3, idleTimeoutMillis: 10_000 })`, `pool.on('error', log)`, one retry on connection-reset errors (Neon drops idle sockets at scale-to-zero). `db/schema.sql`, idempotent. No ORM.
- Hosting: **Render** free web service from the public repo (`.node-version` `22.23.1`, start `next start -p $PORT`). Keep-alive: **UptimeRobot** every 5 min on `GET /api/health` (primary, H26) + GitHub Actions `*/10 * * * *` (secondary, H22). `/api/health` and `/` **never touch the DB** (H16); a cold Render visit costs ≈ 1 min (H1), so the ping is load-bearing.
- Sessions: `iron-session` sealed cookie, `HttpOnly; Secure; SameSite=Lax`, contents `{ sid, github?: {id, login, avatarUrl}, sample?: 'qualifies'|'nearly'|'loophole', activeRuleId? }`. **No GitHub token in the cookie** (facts use the server PAT). POST routes (`quote`, `create`, `capture`, `claim`, `reset`, `publish`) check `Origin` against `APP_URL`.
- AI runtime: Anthropic SDK, forced tool-use with strict JSON schemas, output re-validated with zod. `AI_MODEL` env (default Haiku 5.5; Sonnet 5.5 only if the L5 gate fails).
- Static data in the repo (no reseeding, ever): `data/presets/*.json` (2–3 preset rules), `data/samples/*.json` (3 anonymised snapshots with `recordedAt`), `data/loopholes/<ruleHash>.json` (cached hunts with `computedAt`), `data/popular-repos.json` (search templates), `data/sample-accounts.json` (cost preview). The DB holds only dynamic state; an empty or unreachable DB still renders `/` with the default preset.

### 3.2 Modules
```
src/rules/     types.ts, validate.ts (zod + always-true/bounds/tightening checks), evaluate.ts, price.ts, readback.ts   — pure, no I/O
src/facts/     github.ts (GraphQL → FactSnapshot, server PAT, cache), snapshot.ts (canonical JSON + sha256), samples.ts
src/ai/        compile.ts, loopholes.ts, schema.ts, prompts.ts            — proposes only; never sees an amount
src/paypal/    client.ts (sandbox lock, token cache), orders.ts, refunds.ts, money.ts
src/store/     db.ts, orders.ts, redemptions.ts, refunds.ts, rules.ts, reconcile.ts   — the only code that moves money state
src/app/       page.tsx (shop/checkout) · receipt/[id] · merchant · api/*
```

### 3.3 Rule type (whitelist = 6 fields; best tier wins; percent only)
```ts
type Field = 'account_age_days' | 'followers' | 'public_repos' | 'commit_contributions_last_year'
           | 'merged_prs' /* count after filters */ | 'max_repo_stars_merged_pr' /* after filters */;
type PrFilters = { minRepoStars?: number; minLinesChanged?: number; excludeOwnRepos?: boolean; excludeForks?: boolean;
                   mergedSince?: 'year_start' | ISODate; minAccountAgeDaysAtMerge?: number };
type Condition = { field: Field; op: 'gte'; value: number /* integer ≥ 1 */; pr?: PrFilters /* PR fields only */ };
type Tier = { id: string; label: string; discountPercent: number /* integer 1..90 */; conditions: Condition[] /* 1..3, AND */ };
type Rule = { version: 1; tiers: Tier[] /* 1..3 */ };
```
- `op` is only `gte` with `value ≥ 1` on non-negative counts → **no always-true condition can exist**; a tier needs ≥ 1 condition → "free for everyone" cannot compile. No absolute (`cents`) discounts, no stacking (Fable R4): the model can never express an amount.
- Bounds: age ≤ 15 000 days, stars ≤ 10 000 000, lines ≤ 1 000 000, counts ≤ 100 000, `mergedSince` not before 2008-01-01.
- `evaluate(rule, snapshot, now) → { tiers: TierResult[], appliedTierId? }` — `now` is `snapshot.recordedAt` for samples/cached counterexamples (clock frozen, labelled "evaluated as of <date>") and `snapshot.fetchedAt` for live data. `year_start` resolves against `now`. Each TierResult carries, per condition, actual value, threshold, pass/fail, and the deciding facts (PR URLs / profile URL when the snapshot has them) → the build-up and the "what's missing" view.
- `price(rule, result, listCents) → { earnedCents, discountCents, lines[] }`: single best tier (largest `discountPercent`, ties → first); `discount = round_half_up(list × pct / 100)` in integer cents; lines render every tier (pass/fail, "superseded" for satisfied-but-not-best).
- Tightening (loophole hunt) = a patch from a closed set: raise/add `minRepoStars | minLinesChanged | minAccountAgeDaysAtMerge`, set `excludeOwnRepos | excludeForks`, add `account_age_days gte N`, raise an existing threshold. Code accepts it only if `validate()` passes, `isNotLooser(old, new)` holds (same tiers and discounts; every old condition kept with ≥ threshold; only added restrictions), and the counterexample no longer satisfies the tier. Publish is always a separate click.

### 3.4 Facts snapshot
```ts
type FactSnapshot =
  | { version: 1; kind: 'guest'; fetchedAt: ISO }
  | { version: 1; kind: 'github'; source: 'live' | 'sample'; fetchedAt: ISO; recordedAt?: ISO; label?: string;
      user: { login?: string; url?: string; createdAt: ISO; followers: number; publicRepos: number; commitContributionsLastYear: number };
      mergedPrs: Array<{ url?: string; number?: number; mergedAt: ISO; additions: number; deletions: number; changedFiles: number;
                         repo: { nameWithOwner?: string; url?: string; stars: number; ownerLogin?: string; ownerIsAuthor: boolean; ownerType: 'User'|'Organization'; isFork: boolean } }>;
      truncated: boolean };
```
- Fetch always with `GITHUB_SERVER_TOKEN` (G30, proven by P3): `user(login){ databaseId … }` + `search(type: ISSUE, first: 100, query: "is:pr is:merged author:<login> <merged:>=…> sort:created-desc")` + `rateLimit`, up to 3 pages (300 PRs), `truncated` beyond. **Window rule:** if any PR condition in the rule lacks `mergedSince` → no date qualifier at all; otherwise the earliest `mergedSince` across tiers. So a rule's conditions are never evaluated on data the query didn't fetch (the brief's own example — "20% for any merged PR" — needs the unbounded fetch). The fetched `databaseId` must equal `session.github.id`, else the quote is refused (login rename/reuse).
- `snapshotHash = sha256(canonicalJson(snapshot))` (sorted keys, no whitespace). The exact canonical bytes are stored (`snapshot_json text`), never re-serialised from jsonb.
- Caches/limits: snapshot cache keyed by `login + window` for 10 min (memory). Client IP from Render's `X-Forwarded-For` (first hop). Tight caps apply only to what spends money or PAT points: live GitHub fetches 20/h per IP, compile 10/h per IP + 200/day global + cache by `sha256(sentence)`, live loophole 3/h per IP + 50/day global; sample and guest quotes 200/h per IP (judges behind one NAT). `rateLimit.remaining` logged; below 500 → cached/labelled fallbacks only.
- `ownerIsAuthor` = `repo.owner.login === user.login` (G21; org-admin not visible → labelled).
- Samples (`data/samples/*.json`): built once from real public accounts with the PAT, then anonymised: no `login`, `url`, user id, PR `url`/`number`; `createdAt`/`mergedAt` coarsened to month; `followers`, `publicRepos`, `commitContributionsLastYear`, repo `stars`, `additions/deletions` all stored as **bucket midpoints** (buckets: 0, 1–2, 3–9, 10–49, 50–199, 200–999, 1k–4.9k, 5k–19k, 20k–99k, 100k+); `nameWithOwner` kept **only** on the `qualifies`/`nearly` samples and only for repos ≥ 20 000 stars, never on the `loophole` sample or on counterexamples (shown as "a ~<bucket>★ repo, name withheld"); labels `sample-qualifies | sample-nearly | sample-loophole`; shown with "recorded snapshot of real public data, anonymised, <recordedAt>". Loophole counterexamples: ordinal labels ("account A"), same bucketing, no logins or repo names in the cache file. A build-time test asserts each sample evaluates to its label under the default preset with the clock at `recordedAt`.

### 3.5 Money path — states, tables, transitions (only `src/store` moves them; every transition is compare-and-set)
`orders.state`: `quoted → created → approved → capturing → captured → refunding → refund_pending → refunded_partial`; side states `failed | cancelled | expired | mismatch`. Licence exists only in `captured` or later. Purchase columns (`snapshot_json, snapshot_hash, list_cents, earned_cents, discount_cents`) are **immutable after `created`**; the claim writes to `refunds`.

```sql
rules(id uuid pk, version int, sentence text, compiled jsonb, readback text, created_at)
orders(id uuid pk, state text, rule_id uuid, rule_version int, session_id text not null, buyer_key text null /* 'github:<id>' | 'sample:<name>:<sid>' | null=guest */,
       snapshot_json text, snapshot_hash text, list_cents int, earned_cents int, discount_cents int,
       paypal_order_id text unique, paypal_capture_id text, capture_status text, capture_reason text, captured_cents int, paypal_fee_cents int,
       capture_attempt int default 0, capture_started_at timestamptz, refunded_cents int default 0, licence_key text,
       created_at, expires_at, updated_at,
       check (refunded_cents = 0 or (captured_cents is not null and refunded_cents <= captured_cents)))
redemptions(buyer_key text pk, order_id uuid unique not null references orders, state text /* pending|redeemed */, created_at)
refunds(id uuid pk, order_id uuid references orders, claim_buyer_key text, claim_snapshot_json text, claim_snapshot_hash text,
        captured_at_claim_cents int, claim_earned_cents int, amount_cents int, state text /* pending|pending_paypal|completed|failed */,
        paypal_refund_id text, paypal_amount_cents int, created_at, updated_at,
        check (amount_cents >= 1 and amount_cents <= captured_at_claim_cents - claim_earned_cents));
create unique index refunds_one_live_per_order on refunds(order_id) where state <> 'failed';
```
Invariants in the schema: one redemption per buyer (PK), one claim per order (`redemptions.order_id unique`), one live refund per order (partial unique index), refund ≤ captured − earned (`refunds` check; for a claimed order "earned" is the claim's earned price, the purchase row keeps list), refunded ≤ captured (`orders` check), one PayPal order per quote (`paypal_order_id unique`).

**Session**: every visitor gets `sid`; all orders carry `session_id`. `/` itself is DB-free; when the sealed session carries `hasOrders=true` (set at quote) the page client-fetches `/api/orders/mine`, which lists orders by `session_id = sid` **or** `buyer_key = github:<id>` (a GitHub buyer who lost the browser finds the order after signing in), reconciling non-terminal ones. Guest reconciliation needs no buyer key.

**Locking rule**: no row lock is ever held across a PayPal HTTP call. Pattern everywhere: short tx with `SELECT … FOR UPDATE NOWAIT` (locked → return current state) → PayPal call with a 10 s timeout → CAS write tx.

**Quote** (`POST /api/quote {sample?}`): facts (live by `session.github.login`, or sample, or guest snapshot); rule = `session.activeRuleId` else default preset; `evaluate` + `price`; insert `orders(state='quoted', expires_at = now()+15 min)`. **`buyer_key` is stored only when `discount_cents > 0`**; a zero-discount purchase is a guest order (no redemption consumed, claimable later via F7). Response: `orderId`, lines, earned price. The client never sends a price.

**Create** (`POST /api/paypal/create {orderId}`): `FOR UPDATE NOWAIT`; if `paypal_order_id` already set → return it (retry-safe). Requires `state='quoted'`, `expires_at > now()`, `session_id = sid`; if `buyer_key` set and a `redemptions` row exists for it (not pointing at this order) → first `reconcileOrder(redemption.order_id)` (a stuck `capturing` order may resolve), then if the row still stands → 409 "already redeemed", order `cancelled`, **before PayPal**. `POST /v2/checkout/orders` with `PayPal-Request-Id: o-<orderId hex32>` (34 chars), `Prefer: return=representation`, `intent=CAPTURE`, `amount.value = earned`, `breakdown.item_total = list`, `breakdown.discount = list − earned` **only if > 0** (else no `discount` key), one item `{name, quantity:"1", unit_amount: list}`, `custom_id = "<orderId>:<snapshotHash>"`, `invoice_id = orderId`. Store `paypal_order_id`, state `created`. Any body field named `price`/`amount`/`cents` → 400 "prices are computed server-side" (this is the visible tamper demo).

**Capture** (`POST /api/paypal/capture {paypalOrderId}` from `onApprove`):
1. Tx A: `UPDATE orders SET state='approved' WHERE paypal_order_id=$1 AND state='created'`; then `UPDATE … SET state='capturing', capture_started_at=now(), capture_attempt=capture_attempt+1 WHERE … AND state='approved' AND created_at > now() − interval '60 min' RETURNING *` (older → `expired`, redemption released). 0 rows → read the row: `capturing` younger than 30 s → `{state:'capturing'}` (client polls `/receipt/[id]`); `capturing` older → run `reconcileOrder()` inline and return its result; `captured` → receipt link; else 409 with the state. If `buyer_key` set: `INSERT redemptions(buyer_key, order_id, 'pending')`; PK conflict pointing at **this** order → continue; at another order → roll back, order `cancelled`, 409.
2. `POST /v2/checkout/orders/{id}/capture`, `PayPal-Request-Id: c-<orderId hex32>-<attempt>` (36 chars; new key per attempt so a stored decline is never replayed), `Prefer: return=representation`.
3. Outcome table (every row is a CAS `WHERE state='capturing'`):
   | PayPal says | Order | Redemption | Client |
   |---|---|---|---|
   | capture `COMPLETED`, `currency_code == USD`, `amount == earned` | `captured`; store capture id/status/cents/fee; `licence_key = "EP-"+base32(hmac_sha256(LICENSE_HMAC_SECRET, capture_id)).slice(0,20)` | `redeemed` | receipt |
   | capture `COMPLETED`, `amount != earned` or currency ≠ USD | `mismatch`; store everything; **no licence** | `redeemed` (money moved) | receipt shows red mismatch |
   | capture `PENDING` (+reason) | stays `capturing`; store capture id, `capture_status='PENDING'`, `capture_reason` | `pending` | "payment pending at PayPal (<reason>); licence issued when it completes" |
   | capture `DECLINED`/`FAILED` (even HTTP 201) | `failed`; store capture id/status | **deleted** (PayPal confirms no funds) | clear failure, no licence (F9) |
   | 422 `INSTRUMENT_DECLINED` | back to `approved` | deleted | `restart` → `actions.restart()` |
   | 422 `ORDER_NOT_APPROVED` | back to `created` | deleted | "approve the payment first" |
   | 422 `ORDER_ALREADY_CAPTURED`, timeout, 5xx, 429, network, unknown issue | stays `capturing` | **kept pending** | `{state:'capturing'}` → receipt page reconciles |
   Only PayPal-confirmed "no capture" outcomes release a redemption.
4. `onCancel` → `POST /api/orders/{id}/cancel` → `cancelled` only from `quoted|created|approved`.

**reconcileOrder(id)** (in one tx with `SELECT … FOR UPDATE`; called from `/receipt/[id]` load, `/` load for this session's non-terminal orders, capture step 1, claim, judge "reconcile" button):
| State | Read from PayPal | Transition |
|---|---|---|
| `created`/`approved` | `GET order`: `COMPLETED` → treat as captured path (read `captures[0]`); `APPROVED` → offer "finish payment" (client re-calls capture); `CREATED` older than 6 h (P16) → `expired`; `VOIDED`/404 → `cancelled` | redemption released on `expired`/`cancelled` |
| `capturing`, capture id known | `GET capture` (P30): `COMPLETED` → row 1/2 of the outcome table; `PENDING` → wait; `DECLINED`/`FAILED` → `failed`, release |
| `capturing`, no capture id | `GET order`: `COMPLETED` → `captures[0]` → outcome table; `APPROVED` → re-capture with a new attempt key **only if `capture_started_at` is older than 30 s** (else return `capturing`; the first call may still be in flight); `CREATED` → back to `created`, release; `VOIDED`/404 → `failed`, release |
| `refunding` (refund row `pending`) | `GET order` → `payments.refunds[]` matched by `custom_id == claim hash` (P19/P25, asserted in proof P2; fallback: one live refund per order, so any refund on this capture is ours) → found → Tx D by its status; not found → re-POST refund with the **same** key (P13) → Tx D |
| `refund_pending` | `GET refund` (P29): `COMPLETED` → complete; `FAILED`/`CANCELLED` → refund `failed`, order `captured`, redemption deleted |
| terminal | no-op |

**Receipt** (`/receipt/[orderId]`, F6): `reconcileOrder` then `GET order`; renders **PayPal's** `amount.value`, `breakdown.item_total`, `breakdown.discount`, capture id/status/amount, `custom_id`. Code splits `custom_id`, recomputes `sha256(snapshot_json)`, compares → "fact hash verified" or red "MISMATCH" and no licence. Refunds from `payments.refunds[]`/`GET refund` with the refund's `custom_id` checked against `refunds.claim_snapshot_hash`. If the PayPal GET fails → "PayPal unavailable, retry" — DB figures are never shown as PayPal's.

**Buy first, prove later** (F7, `POST /api/orders/{id}/claim`, signed-in GitHub or sample session): `FOR UPDATE NOWAIT`; requires `state='captured'`, `buyer_key IS NULL`, `session_id = sid` (the OAuth `returnTo` orderId is navigation only; the session is the sole authorisation). Facts now; `evaluate` with the order's **stored** `rule_id/version`; `R = captured_cents − earnedNow`. `R ≤ 0` → "no refund due". Else Tx C: `INSERT redemptions(buyer_key, order_id, 'pending')` (PK conflict → 409 "this account already redeemed"; order conflict → 409 "order already claimed"); `INSERT refunds(…, captured_at_claim_cents, claim_earned_cents, amount_cents=R, 'pending')` (check enforces the cap); order → `refunding`. Then `POST /v2/payments/captures/{capture}/refund`, `PayPal-Request-Id: <refund id hex32>`, `Prefer: return=representation`, body `{amount:{currency_code:"USD", value: toPayPalValue(R)}, custom_id: claim_snapshot_hash}`. Outcomes (CAS): `COMPLETED` with `paypal_amount_cents == amount_cents` → Tx D: refund `completed`, `paypal_refund_id`, `paypal_amount_cents`; `orders.refunded_cents = paypal_amount_cents`, state `refunded_partial`; redemption `redeemed`. `COMPLETED` with a different amount → refund `completed`, order `mismatch` (visible), redemption `redeemed`. `PENDING` → refund `pending_paypal`, order `refund_pending`, redemption `pending`. 409 / timeout / 5xx / unknown → stay `refunding`, reconcile (read-first). Definitive 422 (`REFUND_AMOUNT_EXCEEDED`, `REFUND_TIME_LIMIT_EXCEEDED`, validation) → refund `failed`, order back to `captured` (unclaimed), redemption deleted → buyer can retry; message shows `debug_id`.

**Redemption limit + judge reset** (F8): `redemptions` PK is the limit; sample keys are `sample:<name>:<sid>` so one judge's sample purchase never blocks another judge. `POST /api/judge/reset` (only when `JUDGE_MODE=1`; button labelled "demo only: release this account's redemption"): runs `reconcileOrder(redemption.order_id)` first, then deletes the row for the session's `buyerKey` unless its order is still in `capturing|refunding|refund_pending`; 20/h per IP. Orders and refunds are never deleted → a reset enables a new purchase, never a second refund on an old order.

### 3.6 Sign-in (F3)
`GET /api/auth/github` → `https://github.com/login/oauth/authorize?client_id&redirect_uri=<APP_URL>/api/auth/github/callback&state` with **no `scope`**; `state` = HMAC-signed `{nonce, sid, returnTo?: orderId}`, nonce mirrored in a 10-min cookie. Callback verifies state, exchanges the code (`Accept: application/json`, G3), `GET /user` with the token (covered by zero scope, G2), discards the token, seals `{id: databaseId, login, avatarUrl}` into the session. Samples: `session.sample = name`. Judge mode shows the three sample cards labelled.

### 3.7 AI (F1, F2, F11) — proposes, never decides
- `compileRule(sentence)`: system prompt marks the sentence as untrusted data; the model must call `emit_rule` (schema 3.3) or `refuse({reason, unsupported[]})`. `validate()` rejects unknown fields, bounds, `value < 1`, empty tiers, > 3 tiers, discount outside 1–90. `readback` is generated **by code** from the compiled rule (`rules/readback.ts`), so it cannot misstate the rule. Publish = separate click → new `rules` row, `session.activeRuleId` set (**session-scoped**; nobody else's checkout changes).
- `proposeLoopholes(rule)`: model returns ≤ 5 `{title, why, spiritCheck: 'young_account'|'tiny_pr'|'own_repo'|'fork_repo', params: {maxAccountAgeDays?, maxLinesChanged?}, tightening}` — **no free-text search strings**. Code builds the one search from templates: `is:pr is:merged merged:>=<14 days ago> sort:created-desc` over `data/popular-repos.json` entries that satisfy the tier's `minRepoStars` (or no repo filter), `first: 50`, then fetches ≤ 5 candidate snapshots sequentially; keeps a candidate only if `evaluate()` satisfies the tier **and** the spirit predicate holds (`accountAgeDaysAtMerge < 30`, `additions+deletions ≤ 2`, `ownerIsAuthor`, `isFork`). Presets ship `data/loopholes/<ruleHash>.json` (computed at build time, labelled "cached <date>", clock frozen at `computedAt`); "run one live query" is 1 search + ≤ 5 fetches, labelled live.
- Cost preview (F11): `evaluate` over `data/sample-accounts.json` (N≈40 anonymised snapshots) → "about X% of a sample of N accounts qualify (rough sample, recorded <date>)".
- No model call ever receives `listCents`, `earnedCents`, or any amount; no model output is executed as a query or a publish.

### 3.8 Safety locks
- `paypal/client.ts`: `PAYPAL_ENV === 'sandbox'` and base URL constant `https://api-m.sandbox.paypal.com` (P3), else `instrumentation.ts` logs and calls `process.exit(1)` (a throw alone is not guaranteed to stop `next start`); a test asserts the exit.
- Token cached until `expires_in − 60 s` (P2).
- Every PayPal write: `PayPal-Request-Id` ≤ 38 chars from a stored row id (+attempt for capture), `Prefer: return=representation`; every amount sent comes from a DB row; every amount shown after payment comes from a PayPal GET; `money.ts` is the only cents↔`"24.50"` conversion, exhaustively tested.
- Judge reset and tamper endpoints exist only with `JUDGE_MODE=1`; publish, claim, reset, quote are Origin-checked and rate-limited.
- Session-bound orders: `create`/`capture`/`claim` require `orders.session_id = sid` (or the signed OAuth `returnTo`).

### 3.9 What could break in December, and the answer
| Risk | Answer |
|---|---|
| Render spin-down (15 min) + ~1 min wake | UptimeRobot 5-min ping (primary) + GH Actions 10-min (secondary); both hit `/api/health`, no DB |
| Render 750 h/month | only one Free service in the workspace |
| Neon 100 CU-h/project | DB touched only by judge actions; `/` and `/api/health` DB-free (order list only via `/api/orders/mine` when the session has orders) |
| Neon idle sockets dropped | pool idle timeout 10 s, error handler, one retry |
| Neon project deleted (H17, unverified) | `/` still renders presets; checkout shows "database unavailable" — accepted risk, no free DB avoids it |
| GitHub PAT expiry / exhaustion | expiry > Jan 2027; caches + per-IP limits; labelled cached fallback below 500 points |
| Anthropic balance drained by a bot | compile cache + 200/day global cap; cached presets keep the merchant demo alive |
| Sandbox buyer password changed by a visitor | backup Personal account; you can reset passwords in the developer dashboard |
| Published rule vandalised | rules are session-scoped; default preset is a repo file |
| Sample labels drift ("loophole now blocked" stops being true) | recorded snapshots evaluated with the clock frozen at `recordedAt` |
| Process dies mid-capture / mid-refund | rows stay pending; `reconcileOrder` decides from PayPal reads only |
| GH Actions 60-day rule | repo active until Nov 12 → disables Jan 11 at the earliest |

### 3.10 Out of scope (brief §9): webhooks, Payouts, Disputes, Transaction Search, platform fees, authorize-and-hold, other data sources, merchant accounts, multiple products, dashboards, chatbot/agents/MCP, subscriptions, email.


## 6. L2 log (architecture loop, cap 2 rounds)

### Round 1 — critics on draft v1
- **GPT-6.1 Sol / GPT-6 Astra: unavailable** (ChatGPT usage limit; resets Nov 11 02:31 local). Stand-ins: **Gemini 3.8 Flash** (`omni-flash`, different vendor) and **Fable** (brief's fallback). Both got spec + facts + draft, no opinion from me.
- Gemini 3.8 Flash: 18 findings → 4 blockers confirmed (CHECK constraint rejected every discounted quote; F7 claim made the receipt flag itself MISMATCH; PENDING capture id never stored; `capturing` lock stranded a dropped capture), 10 majors accepted (per-session sample keys, pg pool vs Neon suspend, zero discount line omitted, live hunt capped, PAT protection, structured loophole params, session-scoped rules, PayPal value formatting, PENDING refund not credited, guest order reachable via session), 4 minors accepted (store canonical text, `approved` state, row locks, reset by `buyerKey`). Two judged overstated (points math on the live hunt; PAT exhaustion) but their fixes were cheap and taken.
- Fable: **CHANGES REQUIRED**, 13 required — all adopted: CHECK fix; redemption released only on PayPal-confirmed "no capture" (allow-list of outcomes); full order×capture status table in `reconcileOrder`; every transition compare-and-set; definitive refund rejection → refund `failed`, order back to `captured`, redemption released, partial unique index; purchase columns immutable, claim data on `refunds`, refund `custom_id` = claim hash, guest snapshot variant; per-session sample keys; recorded snapshots evaluated with the clock frozen at `recordedAt`; search window derived from the rule; always-true conditions impossible (`gte` with value ≥ 1 only) and tightenings constrained (not-looser, re-validated, discounts untouched); session-scoped publish; per-IP/global caps + caches on compile/hunt/facts; stronger anonymisation (no ids/logins/URLs, coarsened dates, masked small repos, ordinal labels). 12 recommended → 11 adopted (code-templated searches, attempt counter in the capture key, read-first refund reconcile, drop `cents`/`stack`, paginate to 300, `APP_URL` redirect + `returnTo` in OAuth state + id assertion, cookie flags + Origin checks, server PAT for all facts, pool error handling, UptimeRobot primary, create returns the existing order / omit zero discount; sandbox-lock test + "PayPal unavailable" receipt). Not adopted: none; noted unowned risk (sandbox buyer password) → backup buyer account.

### Round 2 — fresh Fable on v2: **CHANGES REQUIRED** (6 required, 6 recommended) → cap reached
All six required fixes were one-line and are in §3: (1) search window unbounded when any PR condition lacks `mergedSince`; cache key = login + window. (2) reconcile re-captures only after 30 s. (3) `/` DB-free; order list via `/api/orders/mine` only when the session has orders. (4) orders findable by `buyer_key` too; Create and reset reconcile a stuck order before refusing. (5) zero-discount purchases store no `buyer_key` → no redemption burned, claimable later. (6) all counts bucketed; repo names only on qualifies/nearly samples ≥ 20k★, never on loophole-labelled data. Recommended, all adopted: `databaseId` assertion; caps only on live fetches/AI calls, `X-Forwarded-For`; no lock across PayPal calls, `NOWAIT`, 10 s timeout; capture refused after 60 min, USD + refund-amount assertions → `mismatch`; P2 asserts `payments.refunds[].custom_id`; `process.exit(1)` lock, sample-label build test, OAuth `returnTo` navigation-only.
Residual risks Fable accepted (kept in §3.9/§2): money facts documented-only until P1/P2; PENDING states resolve only on page load (no webhooks); receipt URL is bearer access to the licence; H4/H17 unverified; public sandbox buyer credentials; > 300 PRs under-counted; org-controlled repos invisible to `excludeOwnRepos`.

**Cap verdict for you:** two rounds done, no formal sign-off, every finding fixed in place. Recommendation: **continue** (freeze and build); the remaining open items are proofs P1/P2, not design questions.


## Changes after freeze

| Date | Section | Change | One-line reason |
|---|---|---|---|
| 2026-11-10 | 3.1, 3.7 | AI runtime = local OpenAI-compatible model (Ollama, `AI_BASE_URL`/`AI_MODEL`), no Anthropic key; production sets `AI_LIVE=0` and serves precomputed compiled rules and loophole results labelled cached; the merchant box says live compile is unavailable there | owner will not pay for a model API and the deployed app cannot reach a local model in December |
| 2026-11-10 | 3.4 (limits) | Rate limiter: in-memory per process; client = TRUSTED_PROXY_HOPS-th x-forwarded-for hop from the right; IPv6 keyed by /64 (parsed with node:net, IPv4-mapped → IPv4); full table never evicts live counters, new keys share 64 HMAC-keyed overflow shards under one global overflow cap. Accepted residual risk: not shared across instances; a flood of many real addresses can spend the shared overflow | three automated security reviews; further hardening (DB counters) not worth it for a sandbox demo that only limits quote creation |
| 2026-11-10 | 3.5 | Capture outcome table: any client error other than 408/409/429 (and other than ORDER_ALREADY_CAPTURED) is a definitive "no capture": order `failed`, redemption released. Reconcile: `created`/`approved` rows still APPROVED at PayPal expire after 60 minutes; `capturing` rows still APPROVED fail when attempts are exhausted or after 60 minutes. Reconcile that finds a COMPLETED capture claims the buyer's redemption in the same transaction (conflict -> `mismatch`, no licence). Judge reset deletes only the redemption of the order it checked. | independent review: an unknown PayPal error stranded the buyer's redemption with no recovery path, and an order captured outside our route skipped the redemption claim |
| 2026-11-11 | 3.7 (merchant) | A rule can also be built by hand in a form (no model): the form posts the same shape a model would produce to `toRule`/`validateRule`, so the whitelist, bounds and read-back are unchanged | judges could not try their own rule on the hosted build where the model is off |
| 2026-11-11 | 3.5, 3.7 | **Scope break 1, link-scoped publish:** `/shop/<rule id>` opens a published rule for any visitor; it sets `session.activeRuleId` exactly as Publish does (any existing rule id could already be published to a session). Orders keep their own `rule_id`; refunds still price under the order's rule or the shop default, never the session's. Not merchant accounts | a merchant's rule was visible to nobody but the merchant's own browser |
| 2026-11-11 | 3.7 | **Scope break 2, read-only agent interface:** `POST /api/mcp` (Model Context Protocol, JSON-RPC over HTTP) with three tools: read a rule, preview a price for a recorded sample or a public GitHub login, get a checkout link. It uses no session or cookie, creates no order, writes nothing and never calls PayPal. The compiler and hunt models still never see an amount; an outside agent reads a quote exactly as a buyer does, computed by the same `evaluate`/`price` code. Live lookups: 10/h per address, 100/h shared | coupon codes are useless to a shopping agent; a published, machine-checkable rule is not |
| 2026-11-11 | 3.4 (samples) | Cost-preview population re-recorded from GitHub developers with a public repository (three follower bands) instead of merged-PR authors | the old frame made nearly everyone qualify and undermined the merchant pitch |
