# L7 judge panel (2026-11-11)

Four independent models judged the README, an evidence log and a description of what a visitor sees, from the position of a skeptical PayPal AI Hackathon judge: Claude Haiku 5.5, Claude Sonnet 5.5, Gemini 3.8 Flash, Claude Fable. GPT-6.1 Sol and GPT-6 Luna were asked too but their usage limit was still active (resets Nov 11 02:31 local), so they did not run and are not counted. They could not open the app, so this is a judgement of the packet, not of the running product.

| Judge | PayPal | Technical | Innovation | UX | Real-world | Clarity | Advance? |
|---|---|---|---|---|---|---|---|
| Haiku 5.5 | 8 | 7 | 7 | 5 | 4 | 5 | no |
| Sonnet 5.5 | 8 | 8 | 8 | 6 | 5 | 5 | yes |
| Gemini 3.8 Flash | 9 | 8 | 7 | 5 | 4 | 6 | yes |
| Fable | 7 | 8 | 8 | 6 | 5 | 4 | not yet |

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
