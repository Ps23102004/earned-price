# Earned Price

A checkout where the price depends on verified public facts about the buyer — so there is no coupon code to leak.

A merchant types one sentence ("half off for anyone with a PR merged into a 1,000-star repo this year; 20% off for any merged PR; 10% off for accounts older than 3 years"). AI compiles it into a typed rule over a fixed whitelist of GitHub facts and hunts for loopholes before it is published. A buyer signs in with GitHub (zero OAuth scopes) or picks a labelled sample profile; deterministic code evaluates the rule on raw GitHub data, the price ticks down line by line with a link to every fact, and PayPal charges exactly the earned price. The receipt is read back from PayPal and re-checks a hash of the facts that set the price. A guest who paid full price can sign in later and get the difference refunded through PayPal.

**Status:** build in progress for the PayPal AI Hackathon (Nov 2026). PayPal **sandbox only** — the server refuses to start against the live API.

## Documents
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — frozen design: rule type, facts snapshot, money-path state machine, invariants, December-survival table
- [docs/FACTS.md](docs/FACTS.md) — every PayPal / GitHub / hosting fact the design relies on, with source and verification status
- [docs/EVIDENCE.md](docs/EVIDENCE.md) — real sandbox calls (IDs, amounts, dates) read back from PayPal
- [docs/PLAN.md](docs/PLAN.md) — phases, loops, model orchestration, cut order

## Hard rules
- AI proposes; deterministic code decides everything about money. No model ever sets or sees an amount.
- Every money figure shown after payment is read back from PayPal.
- Nothing simulated is presented as real; cached and recorded data is labelled.
- PayPal sandbox only; no real money.

## Run it locally
```bash
pnpm install
cp .env.example .env   # fill in the keys (see docs/PLAN.md §1 for which account gives which key)
pnpm db:migrate
pnpm dev               # http://127.0.0.1:3000
```

## AI tools used (and what each did)
| Tool | Used for |
|---|---|
| Claude Opus 5.5 (Claude Code) | planning, architecture drafting, merging reviews, task specs, integration |
| Claude Sonnet 5.5 | research readers (PayPal docs, GitHub docs, hosting free tiers); main implementer |
| Claude Haiku 5.5 | test/lint/typecheck runner; runtime rule compiler and loophole proposer (structured output only, validated by code) |
| Claude Fable | independent architecture reviews (two rounds), diff reviews, red-team lead |
| Gemini 3.8 Flash | independent architecture critic (different vendor) |

_This table is updated as tools are actually used; models that were planned but never ran are not listed._

## Limitations
See docs/ARCHITECTURE.md §3.9 and the L2 log for accepted residual risks.

## License
MIT — see [LICENSE](LICENSE).
