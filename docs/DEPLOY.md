# Deploy checklist (Render free web service + Neon free Postgres)

Everything below that needs a key or a password is yours to enter. Nothing here asks you to paste a secret into chat.
`render.yaml` is the blueprint; secrets are `sync: false` there, so Render asks you for each one.

## What is already verified here (production build, run locally)
- `pnpm build` passes; `/api/health`, `/` and `/merchant` answer 200 from `next start` in about 100 ms from boot.
- With `AI_LIVE=0` the merchant page compiles the brief sentence and runs the hunt and cost preview from recorded data, all labelled cached; a new sentence answers "Live compiling runs on the merchant's own model".
- `PAYPAL_ENV=live` makes the server print "refusing to start" and exit 1.
- A POST from a foreign Origin is refused (403).

## Steps (in this order)
1. **Neon**: create a project for production, separate from the one your local `.env` uses, so test rows never mix with judges' rows. Copy the pooled connection string (`DATABASE_URL`) and the direct one (`DATABASE_URL_DIRECT`). Apply the schema once from this repository: put both URLs in a temporary `.env` and run `pnpm db:migrate`.
2. **Public repository**: create it only when you decide to (you said to wait). Render and the GitHub Action both read it. Add the MIT licence and README before making it public.
3. **Render**: New → Blueprint → pick the repository. Keep this the only Free service in the workspace (750 instance-hours a month cover one always-on service). Fill the prompted variables:
   - `APP_URL` = the service URL, for example `https://earned-price.onrender.com` (no trailing slash). Set it before the first build finishes, then redeploy once if you change it.
   - `NEXT_PUBLIC_PAYPAL_CLIENT_ID` must be set **before the build**: Next.js bakes it into the browser bundle.
   - `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (sandbox REST app), `JUDGE_BUYER_EMAIL`, `JUDGE_BUYER_PASSWORD` (sandbox Personal account; consider a second backup account), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_SERVER_TOKEN` (fine-grained token, no permissions, expiry after Jan 2027), `DATABASE_URL` (pooled), `SESSION_SECRET` and `LICENSE_HMAC_SECRET` (`openssl rand -hex 32` each; never reuse your local ones).
   - Already set by the blueprint: `PAYPAL_ENV=sandbox`, `AI_LIVE=1`, `JUDGE_MODE=1`, `TRUSTED_PROXY_HOPS=3` and `CLIENT_IP_HEADER=cf-connecting-ip` (see step 6), `NODE_VERSION=22.23.1`.
4. **GitHub OAuth app**: add the callback `https://<render-host>/api/auth/github/callback` next to the local one (one app can hold both).
5. **Keep-alive** (Render sleeps after 15 minutes without traffic and takes about a minute to wake):
   - UptimeRobot (free): HTTP monitor on `https://<render-host>/api/health`, interval 5 minutes. This is the primary.
   - GitHub repository variable `APP_URL` (Settings → Secrets and variables → Actions → Variables) so `.github/workflows/keepalive.yml` pings every 10 minutes. GitHub may delay scheduled runs, so it is the secondary.
   - `/api/health` and `/` never touch the database, so pings do not spend Neon compute hours.
6. **First checks on the deployed URL** (I will run these with you, or you can):
   - `/api/health` is `{"ok":true}`; `/` renders a price; `/merchant` compiles the brief sentence as "cached".
   - Sign in with GitHub: the callback must come back signed in. The app asks for zero OAuth scopes (proof P4 in `docs/EVIDENCE.md`).
   - Client address for rate limits (**checked on the live host, Nov 11**): Render's `x-forwarded-for` arrives as `<client>, <Cloudflare edge>, <Render balancer>`, so the client is the third entry from the right, and a visitor's own extra entries only appear to the left. `cf-connecting-ip` carries the real client and cannot be forged (a forged value is rejected by Cloudflare; a forged `True-Client-IP` is overwritten). The blueprint sets `TRUSTED_PROXY_HOPS=3` and `CLIENT_IP_HEADER=cf-connecting-ip`. The earlier default of 1 hop would have put every visitor in one shared bucket.
   - One sandbox purchase end to end on the deployed URL, then add its row to `docs/EVIDENCE.md`.

## Optional: live compile on the hosted demo (your decision; free tiers only)
**Status (Nov 11):** deployed at https://earned-price.onrender.com with `AI_LIVE=1` against a hosted model (Nebius Token Factory, DeepSeek V4.1 Flash), real GitHub sign-in purchase verified, UptimeRobot and the GitHub Actions keep-alive running. Set `AI_LIVE=0` to fall back to recorded compiles only. To use a different hosted OpenAI-compatible model:
- Set `AI_BASE_URL` (for example Google AI Studio's OpenAI-compatible endpoint, Groq or OpenRouter free models), `AI_MODEL`, `AI_API_KEY` and `AI_LIVE=1` in Render. Enter the key yourself.
- Only the merchant's sentence is sent to that service, never an amount, a buyer, a fact or any key. Output is validated by the same code as always.
- Existing caps apply: 10 live compiles per hour per address, 200 per day in total, then the app falls back to recorded results.
- Do not enable a paid plan without checking the cost first; the app does not need one.
- Rerun `docs/process/L5-compiler-eval.md`'s evaluation (`scripts/eval-compiler.mts`) against the hosted model before trusting it: scores differ by model.

## What can still go wrong in December (see ARCHITECTURE.md §3.9)
- Render and Neon free-tier policies can change; the pings keep Render awake, and Neon is only touched by judge actions.
- The sandbox buyer's password can be changed by anyone who sees it in judge mode; keep the backup account and reset passwords in the PayPal developer dashboard if needed.
- The GitHub token expiry and rate limit: when a live lookup fails or the budget is spent, the quote returns an error that points to the sample profiles; there is no automatic fallback.
