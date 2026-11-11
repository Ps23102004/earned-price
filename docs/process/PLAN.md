> Historical planning document (Phase 0 and 1, Nov 9 2026), moved to `docs/process/` on Nov 11. File paths inside refer to the repository layout at the time; the design itself lives in `docs/ARCHITECTURE.md`.

# PLAN — phases, loops, orchestration

_Brief: PayPal AI Hackathon, deadline Thu Nov 12 2026 12:00 PT. Architecture in [ARCHITECTURE.md](ARCHITECTURE.md), facts in [FACTS.md](FACTS.md), sandbox proofs in [EVIDENCE.md](EVIDENCE.md)._

## 1. Phase 0 — setup check on this Mac (done Nov 9)

### Model team: what is actually callable here

| Role (brief) | Brief model | Here | Call surface |
|---|---|---|---|
| Planner / manager | Opus 5.5 | yes | this session |
| Final reviewer, architecture sign-off, red-team lead | Fable 5.2 | yes | `Agent`/`Workflow` `model: "fable"`, fresh context per review |
| Main implementer | Sonnet 5.5 | yes | `Agent`/`Workflow` `model: "sonnet"` |
| Runner (tests, lint, typecheck, fixtures) | Haiku 5.5 | yes | `Agent`/`Workflow` `model: "haiku"` |
| Independent architecture critic; 2nd reviewer F5–F8 | GPT-6.1 Sol | **out until Wed Nov 11 02:31 local** (ChatGPT usage limit hit on proxy `omni-sol` and Codex; GPT-6 Astra same) | fallback used: **Gemini 3.8 Flash** (`worker models:["omni-flash"]`, different vendor) + Fable (brief's fallback). Retry Sol for the B5/L6 money reviews on Wed. |
| Independent test author | GPT-6.1 Terra | Codex CLI 0.167.0 logged in, `~/.codex/config.toml` `model="gpt-6.1-terra"` — **same ChatGPT limit, out until Wed** | fallback: **Sonnet 5.5 in a fresh subagent** that sees only the spec; switch back to `codex exec` when the limit resets |
| Bulk generation (L5 sentences, fixtures) | GPT-6 Luna | `worker models:["omni-luna"]` (untested; may share the limit) | fallback Haiku 5.5 |
| Research reader | Gemini 3.8 Flash | Gemini CLI missing; `omni-flash` works (used in L2) | L1 readers were Sonnet with web tools (omni-flash cannot fetch pages) |

Rules kept: every model's output is a claim to verify; every brief is self-contained; nobody buys access (brief §4).

### Toolchain / network
- node v22.23.1, npm 10.9.8, pnpm 9.15.9, bun; `gh` logged in (account Ps23102004; scopes gist, read:org, repo, workflow); git; `vercel` CLI 54.4.1 (unused); `render`, `psql` missing (not needed).
- `api-m.sandbox.paypal.com` reachable (401 without creds). `api.github.com` REST + GraphQL reachable (GraphQL 403 unauthenticated); **the cloud container's GitHub block does not apply here** — a live GraphQL call already succeeded (§2.2).
- Shell env carries no API keys (only `ANTHROPIC_BASE_URL`). Everything goes in `.env`.
- `~/.agents/CAPABILITIES/INDEX.md`, `~/Developer/oss-stack/TOOLS.md` (CLAUDE.md references) don't exist → skipped.

### Accounts and keys YOU create (never paste into chat; enter into `.env`, gitignored; `.env.example` ships with blanks)

| # | Account / object | Where | `.env` key(s) |
|---|---|---|---|
| 1 | PayPal Developer → **sandbox REST app** (Apps & Credentials → Sandbox) | developer.paypal.com | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=sandbox` (server refuses to start otherwise), `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (same id, public by design for the JS SDK — P32) |
| 2 | PayPal **sandbox Business** account (the app's owner; default one exists) | Sandbox → Accounts | — |
| 3 | PayPal **sandbox Personal** account (buyer; judges use it) **+ a second Personal account as backup** (anyone who sees the public credentials can change the password — §3.9) | same (⋮ → View/Edit Account shows email + password, P35) | `JUDGE_BUYER_EMAIL`, `JUDGE_BUYER_PASSWORD` (shown in judge mode on purpose; sandbox only) |
| 4 | **GitHub OAuth App**, one app, two callback URLs (up to 10 allowed, G7): `http://127.0.0.1:3000/api/auth/github/callback`, `https://<render-host>/api/auth/github/callback` | github.com → Settings → Developer settings → OAuth Apps | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| 5 | GitHub **fine-grained PAT**, no repository or account permissions selected (public read is always included, G30), expiry after Jan 2027 | Settings → Developer settings → Fine-grained tokens | `GITHUB_SERVER_TOKEN` |
| 6 | ~~Anthropic API key~~ — not used. Local Ollama model (`gemma4:12b-mlx`) for compiler/hunt in dev and the L5 test; production serves cached results (`AI_LIVE=0`) | — | `AI_BASE_URL`, `AI_MODEL`, `AI_LIVE` |
| 7 | **Render** account (free web service, sponsor); env vars set in Render's dashboard | render.com | `APP_URL=https://<render-host>` |
| 8 | **Neon** project (free, no card) | neon.tech | `DATABASE_URL` (pooled), `DATABASE_URL_DIRECT` (migrations, H18) |
| 9 | **UptimeRobot** free account: HTTP monitor on `/api/health`, 5-min interval (primary pinger, H26); GitHub Actions `schedule` is the secondary pinger (no account) | uptimerobot.com | — |
| 10 | Secrets you generate (`openssl rand -hex 32`) | local | `SESSION_SECRET`, `LICENSE_HMAC_SECRET` |
| 11 | Flags | — | `JUDGE_MODE=1` (prod and local) |


## 4. Build plan (Phase 2 → 5), ultracode orchestration

### 4.0 On "go" (this session, ~20 min, no keys needed)
1. `git init` in the project dir, branch `main`; work on `build`. `.gitignore`: `.env*` (keep `.env.example`), `node_modules`, `.next`.
2. Write `docs/FACTS.md` (§2), `docs/ARCHITECTURE.md` (§3 + "Changes after freeze" footer), `docs/EVIDENCE.md` (empty table), `docs/PLAN.md` (§4), `LICENSE` (MIT), `README.md` stub, `.env.example` (every key in §1 with one-line comments).
3. Scaffold `pnpm create next-app@latest` (TS, App Router, ESLint, Tailwind, `src/`); add `vitest`, `zod`, `pg`, `iron-session`, `@anthropic-ai/sdk`, `@paypal/react-paypal-js`, `tsx`. Commit "chore: scaffold".
4. Checkpoint to you with §1's account list → you fill `.env`.

### 4.1 Phase 2 — hour-one proofs (`scripts/proofs/*.ts`, `pnpm tsx`; each appends a row to `docs/EVIDENCE.md`: call, IDs, amounts, date)
| Proof | Needs | Pass condition | Fallback |
|---|---|---|---|
| P1 discount order → capture → GET | PayPal creds; **you** approve once as the sandbox buyer (script prints the approve link) | GET returns `breakdown.discount` and `custom_id` after capture; capture `COMPLETED`; value = net | charge net only; discount in `custom_id` + receipt |
| P2 idempotent partial refund | P1's capture id | two POSTs, same key → same refund id; `GET refunds/{id}` consistent | read-first reconcile already designed; if replay fails, reconcile is GET-only |
| P3 GitHub facts query | `GITHUB_SERVER_TOKEN` | one GraphQL call with `merged:>=` + `sort:created-desc` returns PRs with `owner.login` + `stargazerCount`; `rateLimit.cost ≤ 5` | REST fallback (`/search/issues` + `/repos`) |
| P4 zero-scope sign-in on the Render URL | OAuth app + first deploy | callback sets the session from `GET /user`; also records whether the zero-scope token can run GraphQL (G12, curiosity only) | — |

### 4.2 Phase 3 — L3 per feature, one `Workflow` run each (≤ 9 agents)
Order (brief §8): **B1** skeleton: shop page, fixed-price PayPal, receipt from PayPal, failure path (F5-basic, F6, F9) → sandbox payment end to end at once (L4 row). **B2** rules engine + tests, GitHub facts, sign-in + samples, live price build-up (F3, F4). **B3** earned-price orders with discount line + fact hash, redemption limit + reset (F5-full, F8) → L4. **B4** merchant page: compiler + loophole hunt (F1, F2) → L5. **B5** buy first, prove later (F7) → L4. **B6** deploy + judge mode + keep-alive (F10). **B7** cost preview (F11).

Per feature: (1) I write `docs/specs/B<n>.md` (goal, files, acceptance checks, out of scope, exact interfaces from §3). (2) Independent tests from the spec: Codex `gpt-6.1-terra` when the limit is back, else a fresh Sonnet subagent given **only** the spec + `src/**/types.ts`. (3) `Workflow`: `agent(implement, sonnet)` → ≤ 3 × [`agent(run vitest/eslint/tsc + summarise, haiku)` → `agent(fix, sonnet)`] → `agent(review diff vs spec, fable)`; B3/B5 also get a second independent review (`omni-sol` if back, else `omni-flash`). (4) I fix confirmed findings, commit on `build`, checkpoint to you.

### 4.3 L4 (after B1, B3, B5): real sandbox flow, you approve as buyer when asked; results read back from PayPal → `docs/EVIDENCE.md`.

### 4.4 L5 (B4, cap 3 prompt iterations): `omni-luna` (else Haiku) → ~60 merchant sentences (clear / ambiguous / uncheckable / adversarial incl. injection); I prune to 40 with expected outcomes in `data/eval/compiler-cases.json`; `scripts/eval-compiler.ts` scores by code. Gate ≥ 36/40 and zero uncheckable/injected sentences compiling to a publishable rule. Score → README. Loophole hunt: every shown counterexample must pass `evaluate()`.

### 4.5 Phase 4: L6 red-team (Wed PM, cap 90 min): Fable leads, second attacker `omni-sol`/`omni-flash`; brief §5 attack list + "change the amount", "redeem twice", "refund twice", "replay old order", "forge callback", "inject in sentence", "exhaust rate limit"; each finding → failing test → fix → re-run. L7 judges (Wed eve, cap 60 min): six fresh agents across fable / sonnet / haiku / omni-flash / omni-luna / omni-sol, one judge role each, against the deployed URL + README + video script; fixes < 1 h only.

### 4.6 Phase 5: README (what, run, AI tools used and what each did, L5 score, limitations), LICENSE, Devpost text, shot-by-shot < 3 min script (loophole hunt → price ticking down → payment → refund landing). Thu AM: video + form only.

### 4.7 Time: Mon night: go → 4.0, keys, P1–P3. Tue: B1 (+L4), B2, B3 (+L4). Wed 09:00 cut check (brief §9: F11 → tamper demo → live loophole query → third tier/sample → L7; F7 last). Wed: B4 (+L5), B5 (+L4), B6, B7, L6, L7. Thu AM: video + Devpost.

## 5. Decisions taken this session
- Skipped the router's MoA call for this turn (retrieval + consolidation; no independence gain). Used real independence where it matters: L2 critics.
- Chrome extension unreachable twice → built-in browser → signed out → user paste was the recap only → Phase 1 rebuilt here rather than blocking.
- Dropped `cents` discounts and `stack` mode (not in the brief; `cents` would let a model express an amount).
- Facts always via server PAT; no GitHub token in cookies; zero-scope sign-in is identity only.
- Published rules are session-scoped (no merchant accounts, yet judges must not break each other's checkout).

