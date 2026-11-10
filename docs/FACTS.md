# FACTS — verified claims the design depends on

_Rebuilt Nov 9 2026 on the development Mac. One row per fact: claim, source, status. Status: `verified-by-call` (a real call from this machine, output seen) · `documented` (read on the vendor's official page that day) · `unverified` (not found or inferred; needs a Phase 2 proof or an L4 sandbox call). Every money fact stays at most `documented` until a row exists in [EVIDENCE.md](EVIDENCE.md)._


Status vocabulary: `verified-by-call` (a real call made from this Mac, output seen) · `documented` (read on the vendor's official page today) · `unverified` (not found / inferred; needs a Phase 2 or L4 call). Every money fact stays at most `documented` until L4.

### 2.1 PayPal REST (reader: Sonnet 5.5 with web tools; official pages + linked OpenAPI `schema.json`; nothing here is verified until L4)

| # | Claim | Source | Status | Note |
|---|---|---|---|---|
| P1 | `POST /v1/oauth2/token`: HTTP Basic `client_id:secret`, form body `grant_type=client_credentials` | developer.paypal.com/api/rest/authentication/ | documented | |
| P2 | Token response `{scope, access_token, token_type: Bearer, app_id, expires_in, nonce}`; sample `expires_in` 31668 s | same | documented | cache until `expires_in − 60 s` |
| P3 | Sandbox host `https://api-m.sandbox.paypal.com`; live `https://api-m.paypal.com` | …/api/rest/requests/ | documented | the lock constant |
| P4 | Create order requires `intent` (`CAPTURE`/`AUTHORIZE`) and 1–10 `purchase_units`, each with `amount{currency_code, value(string)}` | …/api/orders/v2/orders-create | documented | |
| P5 | `amount.breakdown` = `item_total, shipping, handling, tax_total, insurance, shipping_discount, discount`; none may be negative | …/orders/v2/definitions/amount_breakdown | documented | discount goes in `breakdown.discount`; zero value unverified → omit when 0 |
| P6 | Rule: `value = item_total + tax_total + shipping + handling + insurance − shipping_discount − discount` | …/definitions/amount_with_breakdown | documented | exact quote on page |
| P7 | `item_total` required when `items[].unit_amount` sent and must equal Σ `unit_amount × quantity`; items need `name, quantity, unit_amount` | amount_breakdown | documented | one item, qty "1", unit = list |
| P8 | `items[]` optional when a breakdown is given | orders-create | unverified (schema inference) | immaterial: one item always sent |
| P9 | `custom_id` max **255**; not shown to payer; returned on `capture` and `refund` objects | …/definitions/purchase_unit_request | documented | `<orderId>:<sha256>` = 101 chars |
| P10 | `invoice_id` max 127, unique per merchant by default → `DUPLICATE_INVOICE_ID` | same + …/orders/v2/errors/ | documented | `invoice_id = orderId` = second belt |
| P11 | `PayPal-Request-Id` (POSTs): re-sending a stored id "returns the latest status of the previous request"; omit → duplicate | …/api/rest/reference/idempotency/ | documented | idempotency page cites a **38 single-byte character limit** → every id ≤ 38 chars |
| P12 | Orders v2 keys stored **6 hours** (72 h via account manager) | developer.paypal.com/sdk/orders/v2/orders-create/ | documented | key is a belt; one-capture-per-order (P21) is the guard |
| P13 | Refund `PayPal-Request-Id` re-sendable for **45 days** | …/api/rest/requests/ (example) | documented | refund reconciliation reads first, re-POSTs second |
| P14 | `Prefer: return=minimal` is default (`id, status, links`); `return=representation` returns the full resource | orders-create / capture / refund | documented | send `representation` on create, capture, refund |
| P15 | Order `status`: CREATED, SAVED, APPROVED, VOIDED, COMPLETED, PAYER_ACTION_REQUIRED | …/api/orders/v2/schema.json | documented | COMPLETED still requires checking `captures[].status` |
| P16 | Order validity: 6 h for redirect + 6 h for approval/capture by default (24/48/72 via account manager) | schema.json | documented | reconcile `created` orders > 6 h old → `expired` |
| P17 | Capture requires prior buyer approval (or a `payment_source`); 201 first time, 200 on idempotent retry | …/orders-capture | documented | |
| P18 | Capture response: `purchase_units[].payments.captures[]{id, status, amount, final_capture, seller_receivable_breakdown{gross_amount, paypal_fee, net_amount}, custom_id, create_time}` | …/platforms/checkout/standard/integrate | documented | breakdown absent while PENDING |
| P19 | `GET /v2/checkout/orders/{id}` schema has `purchase_units[].amount.breakdown`, `custom_id`, `invoice_id`, `payments.{captures,refunds}[]` | schema.json | documented (post-capture example absent) | **proof P1** |
| P20 | Error body `{name, message, debug_id, details[]{field, value, location, issue, description}, links[]}`; business failures = 422 | …/api/rest/responses/ | documented | surface `debug_id` |
| P21 | Issues: `AMOUNT_MISMATCH`, `ITEM_TOTAL_MISMATCH`, `ORDER_NOT_APPROVED`, `ORDER_ALREADY_CAPTURED` ("only one capture per order"), `INSTRUMENT_DECLINED`, `DUPLICATE_INVOICE_ID` | …/orders/v2/errors/ | documented | |
| P22 | `INSTRUMENT_DECLINED` recovery = `actions.restart()` in `onApprove` (same order, new funding source) | …/checkout/standard/customize/handle-funding-failures | documented | |
| P23 | Capture `status`: COMPLETED, DECLINED, PARTIALLY_REFUNDED, PENDING, REFUNDED, FAILED; a declined capture can be **HTTP 201 with `DECLINED`** | schema.json + integrate guide | documented | licence only on `COMPLETED` |
| P24 | `status_details.reason` for PENDING incl. ECHECK, PENDING_REVIEW, UNILATERAL, … | schema.json | documented | show reason, no licence |
| P25 | Refund `POST /v2/payments/captures/{id}/refund`: empty body = remaining balance; `amount{currency_code, value}` = partial; also `custom_id`/`invoice_id` (127), `note_to_payer` (255) | …/api/payments/v2/captures-refund/ | documented | refund `custom_id` = claim hash |
| P26 | Refund response `{id, status, amount, seller_payable_breakdown{…, total_refunded_amount}, create_time, links}`; status COMPLETED/PENDING/CANCELLED/FAILED; 201 first, 200 on retry, **409 while a previous call is in progress** | payments/v2/schema.json | documented | 409 → leave pending, reconcile |
| P27 | Multiple partial refunds allowed until captured amount exhausted → `REFUND_AMOUNT_EXCEEDED`; no count cap found | …/checkout/refund-payment/ | documented | PayPal's cap is captured − refunded; ours (captured − earned) is tighter → DB |
| P28 | Refund window 180 days from capture | refund-payment guide | documented | |
| P29 | `GET /v2/payments/refunds/{id}` returns refund fields; `links[rel=up]` → capture | schema.json | documented | receipt read-back |
| P30 | `GET /v2/payments/captures/{id}` returns `id, status, amount, final_capture, seller_receivable_breakdown, invoice_id, custom_id, …` | schema.json | documented | reconcile PENDING captures |
| P31 | JS SDK v5 script `https://www.paypal.com/sdk/js?client-id=…`; params `currency` (USD default), `intent` (capture default), `components`, `disable-funding` | developer.paypal.com/sdk/js/v5/configuration | documented | a v6 SDK exists (not read); `@paypal/react-paypal-js` wraps v5 |
| P32 | Client-id is safe to expose | …/api/rest/ | unverified (implied: "You only need a client ID to get a PayPal payment button"; the secret must stay secret) | standard practice |
| P33 | Buttons callbacks: `createOrder` → return order id; `onApprove(data.orderID)` → server capture; `onCancel(data.orderID)`; `onError` catch-all | …/sdk/js/v5/reference | documented | |
| P34 | Server-side pattern: server creates, server captures; SDK callbacks call your endpoints | …/platforms/checkout/standard/integrate | documented | |
| P35 | Sandbox: Business = seller, Personal = buyer; one default of each; email + system password via ⋮ → View/Edit Account | developer.paypal.com/sandbox-testing/accounts | documented | |
| P36 | One REST app belongs to one business account | — | unverified | immaterial: one app |
| P37 | Webhooks not required for create→capture | — | unverified (guide's flow uses none) | brief forbids webhooks; PENDING handled by polling P30 |

Reader's conflict notes: idempotency key length (38 vs 108 vs 10000 across pages → use ≤ 38); refund error names differ between guide and API pages; one guide example sends `amount` as a bare string (spec says object → object); no explicit "approved-but-uncaptured" expiry (6 h inferred); post-capture GET contents inferred from schema (P1 proves).

### 2.2 GitHub (reader: Sonnet 5.5 with web tools; live check via the user's `gh` login)

Live check (read-only `gh api graphql`, Nov 10 ~02:00 UTC): `user(login:"torvalds")` + `search(type: ISSUE, first: 5, query: "is:pr is:merged author:torvalds")` + `rateLimit` succeeded; `rateLimit {cost: 1, remaining: 4987}`; first node `subsurface/subsurface` PR #5048, `stargazerCount 3220`, owner `subsurface` (Organization), +46/−3, 6 files, merged 2026-10-19; user `createdAt 2011-09-03`, followers 331 398, public owned repos 12; `issueCount 73`. Caveat: the `gh` token has scopes `repo, read:org, gist, workflow` — proves the query shape, **not** zero-scope behaviour.

| # | Claim | Source | Status | Note |
|---|---|---|---|---|
| G1 | Authorize: `GET https://github.com/login/oauth/authorize` with `client_id` (required), `redirect_uri`, `state`, `scope`, `allow_signup`, `login` | docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps | documented | `state`: "unguessable random string… to protect against CSRF" |
| G2 | No scope = "read-only access to public information (including user profile info, repository info, and gists)" | …/scopes-for-oauth-apps | documented | exact quote |
| G3 | Token exchange `POST https://github.com/login/oauth/access_token`; `Accept: application/json` → `{access_token, scope, token_type}` | authorizing-oauth-apps | documented | |
| G4 | `gho_` prefix = OAuth access token | …/about-authentication-to-github | documented | |
| G5 | OAuth App tokens are long-lived unless "Expiring access tokens" is enabled | authorizing-oauth-apps | documented | token is used once (`GET /user`) and discarded |
| G6 | Max 10 tokens per user/application/scope combination | authorizing-oauth-apps | documented | |
| G7 | An OAuth App may have **up to 10 callback URLs** | …/creating-an-oauth-app | documented | one app serves localhost + Render |
| G8 | `redirect_uri` optional; omitted → first configured callback | authorizing-oauth-apps | documented | always sent, built from `APP_URL` |
| G9 | Without wildcard matching, `redirect_uri` must exactly match a configured callback | authorizing-oauth-apps | documented | wildcards off |
| G10 | Docs recommend `127.0.0.1`/`::1` over `localhost` for loopback callbacks | authorizing-oauth-apps | documented | local `APP_URL=http://127.0.0.1:3000` |
| G11 | GraphQL endpoint `https://api.github.com/graphql`; OAuth App tokens are an accepted auth method | …/graphql/guides/forming-calls-with-graphql | documented | |
| G12 | A **zero-scope** OAuth token can query public data on GraphQL | — | **unverified** | **no longer a dependency**: facts always use the server PAT (§3.4); P4 records the answer out of interest |
| G13 | GraphQL primary limit 5 000 points/hour per user | …/rate-limits-and-node-limits-for-the-graphql-api | documented + seen | |
| G14 | Cost = Σ unique connection requests ÷ 100, rounded, min 1 | same | verified-by-call | our query cost 1 |
| G15 | `rateLimit { limit cost remaining used resetAt }` | same | verified-by-call | logged on every facts call |
| G16 | Connections need `first`/`last` in 1–100; ≤ 500 000 nodes per call | same | documented | page size 100 |
| G17 | `search` returns max 1 000 results; `issueCount` = total matches | …/graphql/reference/search | documented + seen | paginate by cursor |
| G18 | Search syntax: `is:pr is:merged author:LOGIN merged:>=YYYY-MM-DD`, `sort:created-desc` | …/searching-issues-and-pull-requests | documented | `merged:>=` not run live yet → **proof P3 asserts it** |
| G19 | `PullRequest { additions deletions changedFiles mergedAt merged url number repository }` | …/graphql/reference/pulls | verified-by-call | |
| G20 | `Repository { nameWithOwner stargazerCount isFork owner { login __typename } }`; owner is `User` or `Organization` | …/graphql/reference/repos | verified-by-call | |
| G21 | "Author controls repo" decidable only for user-owned repos (`owner.login == login`) | — | unverified (limitation) | labelled |
| G22 | Org membership private by default | docs.github.com/articles/about-organization-membership | documented | |
| G23 | `Organization.membersWithRole` visibility to third parties undocumented | …/graphql/reference/orgs | unverified | not relied on |
| G24 | `User { createdAt followers{totalCount} repositories(privacy, ownerAffiliations){totalCount} pullRequests(states) contributionsCollection(from,to) }` | …/graphql/reference/users | verified-by-call (first three) | |
| G25 | `totalCommitContributions` = commits in span; `totalPullRequestContributions` counts *opened* PRs | same | documented | merged PRs come from search |
| G26 | REST `GET /users/{username}` → `created_at, followers, public_repos` | …/rest/users/users | documented | REST fallback |
| G27 | REST limits: 60/h unauthenticated per IP; 5 000/h authenticated | …/rate-limits-for-the-rest-api | documented | |
| G28 | REST search: 30 req/min authenticated; ≤ 1 000 results | …/rest/search/search | documented | |
| G29 | Secondary limits: ≤ 100 concurrent; ≤ 2 000 GraphQL points/min; CPU 90 s per 60 s | GraphQL rate-limits page | documented | live loophole hunt kept to ≤ 6 calls, sequential |
| G30 | Fine-grained PAT "always include[s] read-only access to all public repositories"; expiry 1–366 days or none | …/managing-your-personal-access-tokens | documented | PAT on GraphQL proven by P3 |

### 2.3 Hosting / database / pingers (reader: Sonnet 5.5 with web tools; pages fetched fresh Nov 9 2026)

| # | Claim | Source | Status | Note |
|---|---|---|---|---|
| H1 | Render Free web service spins down after 15 min without inbound traffic; spin-up ≈ **1 minute** with a loading page | render.com/docs/free | documented | any inbound request counts |
| H2 | Free instance: 512 MB RAM; CPU unstated | render.com/pricing | documented / unverified | |
| H3 | 750 Free instance-hours per workspace per month; exhausted → all Free services suspended until next month | render.com/docs/free | documented | 744 h for one always-on service → **only one** Free service in the workspace |
| H4 | No Render doc prohibits keep-alive pings (ToS not read) | render.com/docs/free | unverified | accepted risk |
| H5 | Render Free Postgres **expires 30 days** after creation | render.com/docs/free | documented | Nov 12 → Dec 15 = 34 days → external DB |
| H6 | Free filesystem ephemeral; no persistent disks | render.com/docs/free | documented | |
| H7 | Auto-deploy on push to linked branch | render.com/docs/deploys | documented | |
| H8 | Service must bind `0.0.0.0:$PORT` (default 10000) | render.com/docs/web-services | documented | `next start -p $PORT` |
| H9 | Node version: `NODE_VERSION` env > `.node-version` > `.nvmrc` > `engines`; default 24.22.1 | render.com/docs/node-version | documented | `.node-version` = `22.23.1` |
| H10 | Health check path under Settings → Health Checks; 2xx/3xx within 5 s | render.com/docs/health-checks | documented | whether Render's own probe keeps the service awake is unstated → external ping |
| H11 | Env vars via dashboard / bulk `.env` paste | render.com/docs/configure-environment-variables | documented | |
| H12 | Hobby workspace: 5 GB bandwidth + 500 pipeline minutes/month | render.com/pricing, docs/free | documented | ≤ ~100 deploys |
| H13 | Render may suspend a Free service with uncommonly high outbound traffic "for example to an external database" | render.com/docs/free | documented | DB traffic tiny |
| H14 | Neon Free: $0, no card, 100 projects, **100 CU-hours per project per month**, 1 GB storage/project | neon.com/docs/introduction/plans, /pricing (Nov 4 2026) | documented | |
| H15 | Scale-to-zero after 5 min idle, cannot be disabled; wake "a few hundred milliseconds" (longer after > 7 days idle) | neon.com/docs/introduction/scale-to-zero | documented | |
| H16 | CU-hours exhausted → compute suspended until reset; data kept | neon.com/faqs/free-plan-limits-and-quotas | documented | ping never touches DB |
| H17 | No Free-project inactivity deletion policy found; branches auto-archive and unarchive on access | neon.com/docs/guides/branch-archiving | unverified (deletion) | accepted risk; `/` renders without DB |
| H18 | Pooled connection string (`-pooler`); pooler lacks session `SET`/PREPARE → direct string for migrations | neon.com/docs/connect/connection-pooling | documented | |
| H19 | Supabase Free pauses after ~1 week low activity | supabase.com/pricing | documented | not chosen |
| H20 | Turso Free: 100 DBs, 5 GB, no card, "no cold starts" | turso.tech/pricing.md | documented | fallback DB |
| H21 | Vercel Hobby "restricted to non-commercial personal use only"; hackathon use unaddressed | vercel.com/docs/limits/fair-use-guidelines | documented / unverified | not chosen (sponsor is Render) |
| H22 | GitHub Actions `schedule`: min every 5 min; **may be delayed under load**; default branch only | docs.github.com …/events-that-trigger-workflows#schedule | documented | delays can exceed 15 min → secondary pinger only |
| H23 | Public-repo scheduled workflows auto-disable after **60 days** without repository activity | …/disable-and-enable-workflows | documented | fine through Dec 15 |
| H24 | Standard runners in public repos are free | …/github-actions billing | documented | |
| H25 | cron-job.org free, up to 60 runs/hour, signup needed | cron-job.org | documented | tertiary |
| H26 | UptimeRobot Free: 50 monitors, 5-min interval, no card | uptimerobot.com/pricing | documented | **primary pinger** |

