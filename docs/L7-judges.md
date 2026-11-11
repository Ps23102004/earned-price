# L7 judge panel (2026-11-11)

Six independent models judged the README, an evidence log and a description of what a visitor sees, from the position of a skeptical PayPal AI Hackathon judge: Claude Haiku 5.5, Claude Sonnet 5.5, Gemini 3.8 Flash and Claude Fable in the first round; Claude Opus 5.5 and Claude Opus 4.6 Thinking in a second round on a refreshed packet. GPT models were not used (usage limit; the owner chose to skip them). They could not open the app, so this is a judgement of the packet, not of the running product.

| Judge | PayPal | Technical | Innovation | UX | Real-world | Clarity | Advance? |
|---|---|---|---|---|---|---|---|
| Haiku 5.5 | 8 | 7 | 7 | 5 | 4 | 5 | no |
| Sonnet 5.5 | 8 | 8 | 8 | 6 | 5 | 5 | yes |
| Gemini 3.8 Flash | 9 | 8 | 7 | 5 | 4 | 6 | yes |
| Fable | 7 | 8 | 8 | 6 | 5 | 4 | not yet |
| Opus 5.5 (round 2) | 8 | 8 | 7 | 6 | 5 | 8 | yes, narrowly |
| Opus 4.6 Thinking (round 2) | 8 | 7 | 8 | 6 | 5 | 8 | yes |

**Agreed strengths:** the PayPal money path (discount line, idempotent capture and refund, `custom_id` read-back, real sandbox ids); the AI/code boundary; buy-first-prove-later; candid limitations.

**Agreed weaknesses and what was done:**
| Finding | Raised by | Action |
|---|---|---|
| No public URL, video or Devpost text at the time | all four | Deploy steps in `docs/DEPLOY.md` (owner's accounts); script and text in `docs/SUBMISSION.md` |
| Hosted AI is cache-only; a new sentence says "unavailable" | all four | Added five more one-click examples, all precomputed; recorded refusals (uncheckable sentences) are now cached and labelled, so the refusal demo works on the hosted build; README states the cache-only limit up front |
| A buyer could publish a generous rule and claim a refund under it (Fable's 60-second break) | Fable | **Fixed:** a refund is priced under the order's own rule or the shop default, never the claimer's published rule; regression test added |
| Publishing is per browser, so no real multi-merchant product | all four | Kept by design (no merchant accounts); stated in the README and the video script |
| 39/40 compiler score is tuned, not held out | Haiku, Sonnet | Caveat already in the README headline evidence list; held-out run not done |
| Cost preview "98% qualify" looks like a giveaway | Sonnet, Fable | Sample frame is printed under the figure and in the README; wording kept honest, framing to be handled in the video |
| Sample profiles stand in for sign-in, redemption per browser session for samples | Haiku, Flash | By design for judges; documented. GitHub sign-in is the real path |
| Inconsistent numbers and dates (test count, "once complete") | Haiku, Fable | **Fixed** in the README |
| "Fact hash verified" is circular | Haiku | Reworded in the README: it proves the stored facts match PayPal's record, not that GitHub's data was true |
| Org-owned repos slip past the own-repo check; one shared GitHub token | Sonnet, Flash, Fable | Already listed in limitations; sample fallback exists below 500 remaining points |

## Round 2 findings (Opus 5.5, Opus 4.6 Thinking)
| Finding | Action |
|---|---|
| Hosted AI is canned; a judge cannot test arbitrary sentences | Known and stated; eight cached examples plus cached refusals; a hosted model with a spend cap is the upgrade if the owner wants one |
| The refund `custom_id` "<claim hash>:<refund id>" reads as impossible (PayPal's refund id does not exist before the call) | **Clarified:** it is our own refund attempt id; README and receipt label now say "attempt id" |
| "Fact hash verified" overclaims | **Fixed:** the receipt now states it does not prove GitHub's data was true |
| Cost preview is unrepresentative and could mislead a merchant | **Fixed:** a plain warning sits directly above the percentage |
| Self-merge tightening misses org-owned repos (react/react is Organization-owned) | Already a listed limitation; not changed |
| Samples act like coupons; sample redemption is per browser session | By design for judge access; documented |
| No evidence row for a live GitHub OAuth purchase | Open: needs the owner's GitHub sign-in on the deployed URL (also proof P4) |

## Round 3 (after the UX, cost-preview and PayPal-text changes)
Claude Sonnet 5.5, Claude Opus 5.5, Claude Fable, Claude Opus 4.6 Thinking, Gemini 3.8 Flash and Claude Haiku 5.5, on a refreshed packet.

| Judge | PayPal | Technical | Innovation | UX | Real-world | Clarity | Advance? |
|---|---|---|---|---|---|---|---|
| Sonnet 5.5 | 8 | 8 | 7 | 6 | 5 | 7 | yes |
| Opus 5.5 | 8 | 8 | 7 | 6 | 4 | 6 | yes, narrowly |
| Fable | 8 | 8 | 7 | 7 | 5 | 7 | yes |
| Opus 4.6 Thinking | 8 | 8 | 8 | 6 | 5 | 7 | yes |
| Gemini 3.8 Flash | 9 | 8 | 8 | 7 | 5 | 8 | yes |
| Haiku 5.5 | 8 | 8 | 8 | 6 | 4 | 6 | no |

Movement against earlier rounds: UX 5-6 -> 6-7; Clarity 4-8 -> 6-8; PayPal and Technical steady at 8-9; Real-world still 4-5.

| Finding (raised by) | Action |
|---|---|
| Judges cannot try their own rule on the hosted build; the AI is a recording (all six) | **Built:** "Or build a rule by hand (no AI needed)": same whitelist and validator, code-generated read-back, cost preview, publish and repricing of the shop; `AI_API_KEY` support so a free-tier hosted model can be switched on (docs/DEPLOY.md); hand-built path tested |
| Showcase numbers look like a blanket price cut (Opus, Fable, Pro) | **Built:** a code-computed heads-up appears when more than half the sample qualifies; before/after table already shows tier-level effect |
| No evidence row with a real GitHub sign-in purchase (Sonnet, Opus, Fable) | Open: needs the owner's GitHub login on the deployed URL |
| Merchant page is per browser (Pro, Sonnet) | By design; a persistent merchant slug would need merchant identity, not added |
| Doc drift (refund id vs attempt id; test counts) (Opus, Fable) | **Fixed:** wording aligned in README, evidence log and script |
| Refund does not return PayPal's fee (Opus) | Stated in README limitations |
| 39/40 compiler score tuned in-sample (Sonnet, Haiku) | Caveat stays in the README evidence list |
| Receipt licence is bearer access (Flash) | Already a listed limitation |
