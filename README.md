# Earned Price

A checkout where the price depends on verified public facts about the buyer — so there is no coupon code to leak.

A merchant types one sentence ("half off for anyone with a PR merged into a 1,000-star repo this year; 20% off for any merged PR; 10% off for accounts older than 3 years"). AI compiles it into a typed rule over a fixed whitelist of GitHub facts and hunts for loopholes before it is published. A buyer signs in with GitHub (zero OAuth scopes) or picks a labelled sample profile; deterministic code evaluates the rule on raw GitHub data, the price ticks down line by line with a link to every fact, and PayPal charges exactly the earned price. The receipt is read back from PayPal and re-checks a hash of the facts that set the price. A guest who paid full price can sign in later and get the difference refunded through PayPal.

**Status:** feature-complete; built for the PayPal AI Hackathon (submission Nov 12 2026, judging Dec 1–15). See docs/DEPLOY.md for the hosted setup. PayPal **sandbox only** — the server refuses to start against the live API (`PAYPAL_ENV` must be exactly `sandbox`).

## How it works
1. **Merchant** (`/merchant`): one sentence becomes a typed rule over six whitelisted GitHub facts (account age, followers, public repos, commits last year, merged PRs, best repo stars among merged PRs, with PR filters). Code validates it (whitelist, `>=` only, values at least 1, at most 3 tiers, discounts 1–90%) and prints a read-back that code generates. A loophole hunt then looks for real accounts that earn a tier against its spirit (own repos, forks, one-line PRs, brand-new accounts), proposes a tightening that code recomputes and checks, and a cost preview runs the rule over 40 recorded accounts. Publishing is a separate click and applies to the publisher's own browser only.
2. **Buyer** (`/`): sign in with GitHub (zero OAuth scopes) or pick a recorded sample profile. Code evaluates the rule on the raw facts; the price ticks down line by line with a link to every fact. PayPal charges exactly that price, with the discount as its own line on the order.
3. **Receipt** (`/receipt/[id]`): every money figure is read back from PayPal, and the receipt re-hashes the stored facts and compares them with the `custom_id` PayPal holds (`<order id>:<sha256 of the fact snapshot>`). It proves the facts that set the price are the ones stored and tied to PayPal's record; it does not prove GitHub's data was true. No match, no licence. A refund carries `<claim hash>:<refund id>` so a retry can never be mistaken for an earlier attempt.
4. **Buy first, prove later**: a guest pays full price, proves facts afterwards, and the code refunds exactly what was captured minus what the rules now say, through PayPal (idempotent request id, refund read back, one redemption per buyer).

Where the AI sits: it proposes (compiles a sentence, suggests loophole strategies). It never sees or sets an amount, and nothing it outputs is executed as a query, a URL or a publish.

## Evidence, not claims
- `docs/EVIDENCE.md`: every money feature has a row with the PayPal order, capture and refund ids and the amounts PayPal returned (sandbox): discounted capture, idempotent refunds, redemption limit and reset, and buy-then-refund.
- Tests: `pnpm test` (about 900 tests; the money path runs against a real Postgres with PayPal mocked, plus independently written tests from the specs in `docs/specs/`).
- Rule compiler evaluation: 39 of 40 sentences behaved as expected and no uncheckable or injected sentence compiled (`docs/L5-compiler-eval.md`). **Caveat:** the prompt was tuned against about 25 of those 40 sentences, so 39/40 is not a held-out estimate.
- Independent reviews of the money path found real bugs that were fixed with regression tests (stuck captures, a reconcile path that skipped the redemption claim, a refund `custom_id` reuse); an independent red-team pass found no critical or high issue and its fixes are listed in `docs/L6-redteam.md`.

## Documents
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — frozen design: rule type, facts snapshot, money-path state machine, invariants, December-survival table
- [docs/FACTS.md](docs/FACTS.md) — every PayPal / GitHub / hosting fact the design relies on, with source and verification status
- [docs/EVIDENCE.md](docs/EVIDENCE.md) — real sandbox calls (IDs, amounts, dates) read back from PayPal
- [docs/DEPLOY.md](docs/DEPLOY.md) — Render + Neon deploy checklist, keep-alive, first checks on the live URL
- [docs/PLAN.md](docs/PLAN.md) — phases, loops, model orchestration, cut order

## Hard rules
- AI proposes; deterministic code decides everything about money. No model ever sets or sees an amount.
- Every money figure shown after payment is read back from PayPal.
- Nothing simulated is presented as real; cached and recorded data is labelled with its date.
- PayPal sandbox only; no real money.

## Run it locally
```bash
pnpm install
cp .env.example .env   # fill in the keys; docs/DEPLOY.md lists which account gives which key
pnpm db:migrate
pnpm dev               # http://127.0.0.1:3000
```
The merchant compiler uses a local OpenAI-compatible model (Ollama, `AI_BASE_URL` / `AI_MODEL`) in development. The deployed demo runs with `AI_LIVE=0` and serves precomputed, labelled-cached compiles and loophole results.

## AI tools used (and what each did)
| Tool | Used for |
|---|---|
| Claude Opus 5.5 (Claude Code) | planning, architecture drafting, merging reviews, task specs, integration |
| Claude Sonnet 5.5 | research readers (PayPal docs, GitHub docs, hosting free tiers); main implementer |
| Claude Haiku 5.5 | test/lint/typecheck runner |
| Gemma 4 12B (local, Ollama) | development-time rule compiler and loophole proposer (structured output only, validated by code); the deployed demo serves its precomputed, labelled-cached output |
| Claude Fable | independent architecture reviews (two rounds), diff reviews, red-team lead |
| Gemini 3.8 Flash | independent architecture critic and code reviewer (different vendor) |

_This table is updated as tools are actually used; models that were planned but never ran are not listed._

## Limitations (plainly)
- **Live compile is local-only.** Production serves cached compiles and hunts for the example sentences; a new sentence answers "unavailable" there. No paid model API is used.
- **The compiler score is optimistic** (see the caveat above), and the model is a small local one. The hosted demo serves recorded compiles and recorded refusals (each labelled with its date) for the example sentences; any other sentence answers "unavailable" there.
- **Facts**: live GitHub facts come from one server token, so hourly rate limits apply (the app falls back to labelled sample profiles). A repository controlled through an organisation is invisible to the "not my own repo" check; more than 300 merged PRs are truncated and flagged.
- **Samples** are anonymised (no logins, URLs, repo names or exact dates; bucketed counts) but a distinctive account's month of creation and bucketed history can still narrow candidates. The sample profiles and the 40-account cost sample are recorded Nov 2026, not live.
- **Cost preview** runs over authors of recently merged PRs, not a random sample of GitHub, so its percentages are for illustration.
- **PENDING payments or refunds** resolve when a page loads or a button is pressed (no webhooks by design).
- **Rate limits** are in memory, per process, keyed on the client address as the host's proxy reports it, with shared caps behind them.
- **Every visitor is their own merchant.** A rule published on `/merchant` changes only that browser's checkout. A refund is always priced under the rule the order was bought under (or the shop default), never a rule the buyer published afterwards. Sample profiles are recorded stand-ins for GitHub sign-in so judges can try the flow; they are keyed per browser session, so "one redemption per buyer" is per GitHub account but per session for samples. Sessions are stateless sealed cookies, so logout does not revoke a copied cookie (`docs/L6-redteam.md`).
- **Judge mode** shows the sandbox buyer's credentials and a reset button on purpose; sandbox only.
- A receipt URL is bearer access to its order and licence for that browser session.

See docs/ARCHITECTURE.md §3.9 and the L2 log for the full accepted-risk list.

## License
MIT — see [LICENSE](LICENSE).
