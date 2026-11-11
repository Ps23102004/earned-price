# Submission pack: video script and Devpost text

All numbers below are the ones in the repository today. Re-check against `docs/EVIDENCE.md` before recording. PayPal is sandbox; say so on screen.

## Video script (target 2:40, hard limit 3:00)

Record the deployed URL if it is up, otherwise localhost. Use a clean browser profile, 1080p. Keep the sandbox banner visible. Put the dates of anything cached on screen.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Black card: "Coupon codes leak. Facts don't." | "Discount codes get shared. What if the price had to be earned, from facts nobody can fake?" |
| 0:10 | `/merchant`, the brief sentence in the box | "A merchant types one sentence." |
| 0:18 | Click Compile. Rule JSON beside the read-back; chips "AI proposed · code validated" and "cached <date>" | "AI turns it into a typed rule over six public GitHub facts. Code validates it and writes the plain-English read-back itself. The AI never sees or sets a dollar amount." |
| 0:35 | Run the hunt: the loophole finding, anonymised example, "Apply tightening" with the changed line | "Before publishing, it hunts for loopholes. Here it found a real account that would win 50% off by merging into its own repository. Code recomputes the fix and checks it." |
| 0:55 | Cost preview under the rule | "And what the rule would cost over a recorded sample: here, about $14,000 given away per 1,000 sales, and the before/after of the tightening. Rough, labelled, not all of GitHub." Then click Publish. |
| 1:05 | Shop `/`: pick "Qualifies" sample, price build-up ticking down | "A buyer proves public facts, with zero OAuth permissions. Code evaluates the rule and the price ticks down line by line, each with a link to the fact." |
| 1:25 | PayPal sandbox approval, then the receipt: the Paid / Refunded / Net strip, "as recorded by PayPal", "Fact hash verified"; open "PayPal's full record" once | "PayPal charges exactly that. Every figure here is read back from PayPal, and the receipt checks a hash of the facts against the order PayPal holds." |
| 1:50 | Second purchase refused ("already redeemed"); mention reset is demo-only | "One discount per buyer, enforced in the database." |
| 2:00 | Guest buys at $49.00, receipt, "Prove your facts for a refund", claim with a sample | "Or buy first, prove later. Pay full price, prove facts afterwards, and the code refunds exactly the difference." |
| 2:20 | Receipt with refund 24.50 COMPLETED, "Claim hash and attempt id verified"; PARTIALLY_REFUNDED capture | "Refund sent through PayPal with an idempotent request, read back and verified." |
| 2:30 | Repo: `docs/EVIDENCE.md` rows, tests, `docs/L6-redteam.md` | "Every money feature has real sandbox evidence. Independent reviewers and a red team found and fixed real bugs. AI proposes; deterministic code decides everything about money." |
| 2:40 | End card: URL, repo, "PayPal sandbox only" | |

Do not show: the sandbox buyer's password field being typed, `.env`, or any key. If PayPal's popup is awkward to capture, record the approval separately and cut it in.

## Devpost text

**Tagline:** A checkout where the price is earned from verified public facts, not a coupon code.

**Inspiration.** Discount codes leak. Merchants who want to reward open-source contributors, long-time users or active developers have no code-free way to do it. Public GitHub facts can't be shared like a coupon, and anyone can check them.

**What it does.** A merchant describes a discount policy in one sentence. AI compiles it into a typed rule over a fixed whitelist of GitHub facts, code validates it and writes a read-back, and a loophole hunt looks for real accounts that would win a tier against its spirit before the rule is published (with a code-recomputed fix and a cost preview). A buyer proves facts by signing in with GitHub (no OAuth scopes) or choosing a recorded sample profile; deterministic code evaluates the rule, the price ticks down line by line with a link to every fact, and PayPal charges exactly the earned price with the discount as its own line. The receipt is read back from PayPal and re-checks a hash of the facts against the order. A guest who paid full price can prove facts later and get the difference refunded through PayPal.

**How we built it.** Next.js 16 and TypeScript, Postgres on Neon, PayPal Orders v2 and Payments v2 (sandbox): discount line items, idempotent capture and refund with stored request ids, `custom_id` binding the fact hash, a reconcile path that reads PayPal before changing state. A small local model (Ollama) is the rule compiler and loophole proposer during development; the hosted demo serves recorded, dated outputs. The rule engine, pricing, redemption limit and money state machine are plain deterministic code with compare-and-set transitions.

**AI tools used.** Claude Opus 5.5 (planning, integration), Claude Sonnet 5.5 (research, implementation, independent test authoring), Claude Haiku 5.5 (test and lint runs, judging), Claude Fable (architecture and code reviews, red-team), Gemini 3.8 Flash (architecture critic, judging), Gemma 4 12B on Ollama (rule compiler and loophole proposer). GPT-6.1 Sol/Terra/Luna were planned but unavailable (usage limit) and are not credited.

**Challenges.** Keeping AI away from money: it can only propose a percent inside a validated rule. Making refunds and captures safe under retries, timeouts and double clicks. Making "cached" and "recorded" honest everywhere. Independent reviews kept finding real problems (stuck captures, a reconcile path that skipped the redemption claim, a refund id reuse, a refund priced under a buyer-published rule); each became a regression test.

**Accomplishments.** Every money feature has a row of real sandbox evidence read back from PayPal. About 900 automated tests, a compiler evaluation (39/40, with the tuning caveat stated), an independent red-team and a judge panel with the findings published in the repo.

**What we learned.** The interesting design question is where to put the AI/code boundary. Here the AI proposes strategies and rules, and everything that touches money, redemption or a published rule is code that can be tested.

**What's next.** Real merchant accounts and a shared published rule, more fact sources than GitHub, a live compiler on a hosted model, webhooks for pending payments.

**Built with:** Next.js, TypeScript, PayPal REST (Orders v2, Payments v2, JS SDK), GitHub GraphQL and OAuth, Postgres (Neon), Render, Ollama.

**Try it.** Sandbox only. Judge mode on the site shows a sandbox buyer; or pay with the test card shown there. Each GitHub account or sample profile can redeem once; use the demo-only reset on the page to repeat.
