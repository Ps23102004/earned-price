# B2 — Facts, sign-in, sample profiles, live price build-up (F3, F4)

Architecture: `docs/ARCHITECTURE.md` §3.3, §3.4, §3.5 (Quote), §3.6. Verified facts: `docs/FACTS.md` (G-rows, bottom table), `docs/EVIDENCE.md` P3. Existing and reusable: `src/rules/*` (evaluate, price, validate, readback, `isNotLooser`), `src/facts/{types,snapshot}.ts`, `src/store/*`, `src/session.ts` (`getSession`, `guarded`), `src/ratelimit.ts` (`allow`, `clientIp`), B1 routes and pages. **Next.js 16**: read the relevant guide under `node_modules/next/dist/docs/01-app/` before writing routes/pages (`cacheComponents` is on: request-time data such as cookies must be read inside `<Suspense>` or a route handler).

## Goal
A buyer proves facts by signing in with GitHub (zero scopes) or choosing one of three labelled sample profiles. The server evaluates the active rule on raw GitHub facts, and the page shows the price ticking down line by line, each line linking to the public fact, and a non-qualifying buyer sees exactly what is missing. The resulting quote feeds the existing B1 create/capture flow (create already sends `breakdown.discount` when discount > 0).

## Out of scope
Redemption table writes and judge reset (B3); rule compiler, loophole hunt, merchant page (B4); refund/claim (B5); deploy (B6). Do not build them.

## Pure modules (independent tests are written from this spec alone)

### `src/rules/presets.ts`
```ts
export const LOOSE_RULE: Rule;    // the merchant's sentence as typed (loophole-able)
export const DEFAULT_RULE: Rule;  // hardened: what the shop publishes
export const PRESETS: Record<"loose" | "default", Rule>;
```
`LOOSE_RULE` (ids `t50`,`t20`,`t10`; labels "OSS contributor", "Any merged PR", "Veteran account"):
- `t50` 50%: `{field:"max_repo_stars_merged_pr", op:"gte", value:1000, pr:{mergedSince:"year_start"}}`
- `t20` 20%: `{field:"merged_prs", op:"gte", value:1}`
- `t10` 10%: `{field:"account_age_days", op:"gte", value:1095}`
`DEFAULT_RULE`: same ids/labels/percents, hardened:
- `t50`: `max_repo_stars_merged_pr >= 1000` with `pr:{mergedSince:"year_start", excludeOwnRepos:true, excludeForks:true, minLinesChanged:10}`
- `t20`: `merged_prs >= 1` with `pr:{excludeOwnRepos:true, minLinesChanged:10}`
- `t10`: `account_age_days >= 1095` AND `public_repos >= 1`
Both must pass `validateRule`; `isNotLooser(LOOSE_RULE, DEFAULT_RULE)` must be `true`.

### `src/facts/window.ts`
`searchWindow(rule: Rule, now: Date): { needsPrs: boolean; mergedSince?: string }`
- no condition uses a PR field (`merged_prs`, `max_repo_stars_merged_pr`) → `{needsPrs:false}`.
- some PR condition has no `pr.mergedSince` → `{needsPrs:true}` (no date qualifier at all).
- otherwise → `{needsPrs:true, mergedSince}` = the earliest across PR conditions, as `YYYY-MM-DD`; `"year_start"` resolves to Jan 1 of `now`'s UTC year.

### `src/facts/anonymise.ts`
- `bucket(n: number): number` → midpoint of its bucket; buckets `0`, `1–2`, `3–9`, `10–49`, `50–199`, `200–999`, `1,000–4,999`, `5,000–19,999`, `20,000–99,999`, `≥100,000`. Midpoints: `0, 1.5→2 (use 2)`, `6`, `30`, `125`, `600`, `3000`, `12500`, `60000`, `100000`. Non-integer/negative/NaN input → `0`. Monotonic.
- `coarsenMonth(iso: string): string` → `YYYY-MM-15T00:00:00.000Z` for a valid ISO timestamp with offset, else throws.
- `anonymiseSnapshot(s: GithubSnapshot, opts: { label: string; recordedAt: string; keepRepoNames: boolean }): GithubSnapshot` → `source:"sample"`, `label`, `recordedAt`; removes `user.login`, `user.url`, every PR `url`/`number`/`ownerLogin`; `user.createdAt` and each `mergedAt` via `coarsenMonth`; `followers`, `publicRepos`, `commitContributionsLastYear`, repo `stars`, `additions`, `deletions` via `bucket`; `changedFiles` via `bucket`; `repo.url` removed; `repo.nameWithOwner` kept only if `keepRepoNames` **and** original stars ≥ 20,000, else removed; `ownerIsAuthor`, `isFork`, `ownerType` kept; `truncated` kept. Must not mutate the input. Result contains no string from the input's `login`/urls anywhere (test by JSON-scanning).

### `src/auth/state.ts`
- `signState(payload: { nonce: string; sid: string; returnTo?: string }, secret: string, now?: number): string` → `base64url(JSON).base64url(hmacSha256)` with `iat = now`.
- `verifyState(token: string, secret: string, now?: number, maxAgeMs = 600_000): { nonce: string; sid: string; returnTo?: string } | null` → `null` for malformed, wrong signature (timing-safe compare), expired (`now - iat > maxAgeMs`) or future-dated (`iat > now + 60_000`) tokens; never throws.
- `safeReturnTo(v: unknown): string` → `v` only if a string starting with a single `/` followed by a non-`/`, non-`\` character, no `:`, length ≤ 200; else `"/"`.

### `src/rules/explain.ts`
```ts
type ExplainRow = { tierId: string; label: string; discountPercent: number; status: "applied"|"superseded"|"not_met";
  conditions: { text: string; actual: number; threshold: number; passed: boolean; missing?: string; evidence: string[] }[] };
type ExplainView = { rows: ExplainRow[]; listCents: number; earnedCents: number; discountCents: number; appliedTierId?: string; evaluatedAt: string };
explain(rule: Rule, result: EvaluationResult, p: PriceResult): ExplainView
```
- `text` is the phrase `readback` uses for that condition (reuse/export it from `readback.ts`; do not duplicate wording).
- `missing` only on failed conditions: `"needs N more"` for count fields (`N = threshold − actual`), `"needs N more days"` for `account_age_days`, `"needs a repository with at least N stars"` for `max_repo_stars_merged_pr` when `actual === 0`, else `"needs N more stars"` (`threshold − actual`).
- Pure, no clock; `evaluatedAt = result.now`.

### `src/facts/github.ts` (pure mapper + injected-fetch fetcher)
```ts
export type GraphqlResult = { rateLimit: {cost:number; remaining:number; limit:number}; user: {...}|null; search: {...} };
export function toSnapshot(raw: GraphqlResult, login: string, fetchedAt: string, truncated: boolean): { snapshot: GithubSnapshot; databaseId: number }
export async function fetchGithubFacts(login: string, rule: Rule, opts: { token: string; now?: Date; fetchImpl?: typeof fetch; maxPages?: number }): Promise<{ snapshot: GithubSnapshot; databaseId: number; rateLimit: {cost:number; remaining:number} }>
```
- One GraphQL request per page: `user(login){ databaseId createdAt followers{totalCount} repositories(privacy:PUBLIC, ownerAffiliations:OWNER){totalCount} contributionsCollection{ totalCommitContributions } url }` (first page only) + `search(type:ISSUE, first:100, after:$cursor, query:$q){ issueCount pageInfo{hasNextPage endCursor} nodes{... on PullRequest{ url number mergedAt additions deletions changedFiles repository{ nameWithOwner url stargazerCount isFork owner{login __typename} } }} }` + `rateLimit{cost remaining limit}`. `$q = "is:pr is:merged author:<login> [merged:>=<mergedSince>] sort:created-desc"` from `searchWindow`; skip `search` entirely when `needsPrs` is false.
- Up to `maxPages` (default 3) pages; `truncated = hasNextPage still true after the last page`.
- `ownerIsAuthor = owner.login.toLowerCase() === login.toLowerCase()`; `ownerType` from `__typename`.
- `login` must match `/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/` else throw `Error("invalid login")` before any request. Errors from GitHub (HTTP ≠ 200, `errors` array, `user: null`) throw an `Error` whose message contains no token. 10 s timeout per request (`AbortSignal.timeout`).
- Memory cache keyed `login|mergedSince|needsPrs` for 10 min.
- `commitContributionsLastYear` is `contributionsCollection.totalCommitContributions` (default window = last year).

## Backend

### Rules in the DB
`src/store/rules.ts`: `ensureRule(name: "loose"|"default"): Promise<{id: string; version: number}>` — get-or-create a `rules` row with `sentence = "preset:" + name`, `compiled = rule`, `readback = readback(rule)`; idempotent under concurrency (`on conflict` via a unique index on `sentence` added to `db/schema.sql`, guarded and idempotent). The quote stores `rule_id`/`rule_version` on the order.

### Session
Extend `SessionData` with `github?: { id: number; login: string; avatarUrl: string }` and `sample?: "qualifies"|"nearly"|"loophole"`. Signing in clears `sample`; choosing a sample clears nothing but takes precedence only when no `github` is set (sample is a separate mode: `POST /api/quote {sample}` explicit).

### Sign-in routes (zero scope)
- `GET /api/auth/github` → 302 to `https://github.com/login/oauth/authorize` with `client_id`, `redirect_uri = APP_URL + "/api/auth/github/callback"`, `state = signState({nonce, sid, returnTo: safeReturnTo(query.returnTo)}, SESSION_SECRET)` and **no `scope` parameter**; sets cookie `ep_oauth` = nonce (HttpOnly, SameSite=Lax, 10 min, Secure in production). Missing `GITHUB_CLIENT_ID` → 503 JSON.
- `GET /api/auth/github/callback` → verify `state` (signature, age, `sid === session.sid`, nonce equals `ep_oauth` cookie), exchange `code` at `https://github.com/login/oauth/access_token` (`Accept: application/json`, 10 s timeout), `GET https://api.github.com/user` with the token, seal `{id, login, avatarUrl}` into the session, **discard the token** (never stored, never logged), delete `ep_oauth`, 302 to `safeReturnTo`. Any failure → 302 to `/?signin=failed` (no details leaked). A user who denies access (`error=access_denied`) → `/?signin=cancelled`.
- `POST /api/auth/logout` (Origin-checked via `guarded`) → clears `github` and `sample` from the session; 200 `{ok:true}`.

### Quote (extends B1 `POST /api/quote`)
Body `{ sample?: "qualifies"|"nearly"|"loophole" }` (anything else → 400). Resolution order: `sample` given → recorded sample; else `session.github` → live facts; else guest (B1 behaviour, unchanged: no discount). Rule: `DEFAULT_RULE` via `ensureRule("default")`.
- Live: rate limit 20/h per `clientIp` for live fetches (429 `{error}`); `fetchGithubFacts(session.github.login, rule, {token: GITHUB_SERVER_TOKEN})`; refuse (`409 {error:"account changed"}`) if the fetched `databaseId !== session.github.id`; on GitHub failure → `502 {error:"GitHub is unavailable; try again or use a sample profile"}` (never silently price as guest).
- Sample: load `data/samples/<name>.json`, evaluate with `now = snapshot.recordedAt`.
- `evaluate` + `price(rule, result, 4900)`; store `snapshot_json = canonicalJson(snapshot)`, `snapshot_hash`, `list_cents 4900`, `earned_cents`, `discount_cents`, `rule_id`, `rule_version`; `buyer_key` = `github:<id>` | `sample:<name>:<sid>` **only when `discount_cents > 0`** (B1 rule); reuse of an unexpired `quoted` order is allowed **only** if its inputs (`buyer_key` source, sample name, github id, rule id) are identical — otherwise insert a new quote.
- Response: `200 { orderId, listCents, earnedCents, discountCents, view: ExplainView, source: "live"|"sample"|"guest", label?: string, recordedAt?: string, truncated: boolean }`. Never include logins/URLs of samples; for live, evidence URLs are the buyer's own public URLs (fine).

### Samples (recorded snapshots of real public data)
`scripts/build-samples.mts` (run once with `pnpm tsx --env-file=.env scripts/build-samples.mts`; writes `data/samples/{qualifies,nearly,loophole}.json`; commit the output) selects real public accounts with `GITHUB_SERVER_TOKEN`, then anonymises with `anonymiseSnapshot` (`recordedAt = now`, `keepRepoNames: true` for qualifies/nearly, `false` for loophole). Selection (code decides, by evaluating against the presets with `evaluate`):
- `qualifies`: under `DEFAULT_RULE` the `t50` tier applies.
- `nearly`: under `DEFAULT_RULE` the applied tier is `t20` or `t10` and the best repo's stars are in 500–999 (so it narrowly misses `t50`); if none found, any account whose applied tier is `t20` with max stars ≥ 300.
- `loophole`: under `LOOSE_RULE` the `t50` tier applies **and** under `DEFAULT_RULE` no tier applies or only `t10`/`t20`... precisely: `LOOSE` applies `t50`, `DEFAULT` does not apply `t50` (an own-repo or tiny-PR case). Prefer a case where `DEFAULT` applies nothing.
Search for candidates with the GraphQL search API over recent merged PRs in repos of 1,000–20,000 stars (`is:pr is:merged merged:>=<Jan 1> stars:...` is not valid on PR search — instead search repositories `stars:1000..20000 pushed:>=<30 days ago>` then recent merged PRs per repo, ≤ 40 candidate accounts, ≤ 400 GraphQL points total). Time-box: if a label cannot be found within the budget, stop and report which one; do not fabricate or hand-edit data. The script prints a summary (label, applied tier under each preset, bucketed stats; never logins) and the build-time test asserts each file evaluates to its label.
`data/samples/*.json` is committed; the app never calls GitHub for samples.

## Frontend
All text plain, accessible, 375 px-safe, dark/light, `prefers-reduced-motion` respected (no animation then).
- Shop page flow (replaces B1's single "Get price" button): step 1 "Prove" — a **Sign in with GitHub** button (`<a href="/api/auth/github?returnTo=/">`), and three **sample cards** (`qualifies`, `nearly qualifies`, `loophole account (now blocked)`), each labelled "Recorded snapshot of real public data, anonymised, <recordedAt date>"; plus a quiet "Continue as guest ($49)" link which behaves as B1. Signed-in state shows avatar, `@login`, "Not you? Sign out" (`POST /api/auth/logout`) and a "Get my price" button. Query `?signin=failed|cancelled` shows a clear inline message.
- Step 2 "Price": after `POST /api/quote`, render the **price build-up**: list price `$49.00`, then each tier row in rule order; the applied row ticks in (≈350 ms stagger) and the running price counts down to the earned price; each condition line shows the readable text, `actual / threshold` with ✓/✗ (icon + text), and an evidence link `<a>` per URL (opens in a new tab with `rel="noreferrer noopener"`); failed conditions show `missing`; superseded tiers are shown dimmed with "passes, but a better tier applies"; the final line "You pay $X.XX" (label "price quote"). Source badge: "Live from GitHub (just now)" or "Recorded snapshot, <date>"; `truncated` shows "Only your 300 most recent merged PRs were checked".
- Step 3 "Pay": the B1 PayPal button for this quote (`createOrder` → B1 create route). Changing profile requests a new quote.
- Do not show a login or repository name for samples.
- A `<details>` "The rule" element showing `readback(rule)` and the rule's JSON.

## Tests / acceptance
1. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm exec next build` pass.
2. Independent tests (authored from this spec only) cover every pure module above, including the property that `anonymiseSnapshot` output contains none of the input's identifying strings and that sample files evaluate to their labels (build-time test).
3. Live (integrator, in the sandbox, recorded in EVIDENCE): sample `qualifies` quote shows ≈$24.50 and a PayPal order is created with `breakdown.discount 24.50` and `custom_id <orderId>:<hash>`; `nearly` shows the missing-fact text; `loophole` shows the tightened rule blocks it; guest still $49.00; capture of the discounted order read back from PayPal.
4. Sign-in: unit tests for `state`; callback rejects a tampered state, an expired state, a wrong cookie nonce and another session's `sid`; the browser flow is exercised by the owner once.
