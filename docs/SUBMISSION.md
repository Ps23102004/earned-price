# Submission pack: video script and Devpost text

Claims match the repository and the live site as of Nov 11. PayPal is sandbox only; say so on screen. The site must stay up, with working credentials, until Dec 15 2026, 8:00 AM PT.

## Video: what was shot (2:53)

A recorded talk over the app's real screens. The pay and refund steps are shown as the figures PayPal returned for real sandbox orders (ids below), not as live footage of a PayPal approval.

| Time | Section | On screen |
|---|---|---|
| 0:00 | Hook | A discount-code box types a code, stamped "LEAKED" |
| 0:04 | Intro and problem | Presenter; hand-reviewed forms, leaky codes, agents that can't fill in a form |
| 0:25 | Problem statement | "How do you give a discount to people who have earned it, without a form, without a code, and without trusting the buyer?" |
| 0:37 | Solution | Live shop, recorded "Qualifies" sample (labelled): price builds from $49.00 to $24.50 |
| 1:04 | Pay | The Pay section, then the read-back of a different real purchase: order 8UL89980VA964960L, item total 49.00, discount 9.80, total 39.20 (a real GitHub buyer under a hand-built 20% rule) |
| 1:19 | Merchant | Brief example compiled (recorded result, labelled), rule beside the code-written read-back |
| 1:42 | Loophole hunt | Recorded example (Nov 10): three anonymised self-merging accounts, Apply tightening, cost table (42-account sample, not a forecast) |
| 2:06 | Buy first, prove later | Real sandbox refund: order 1RE633727M225204R, capture 49.00, refund 1N172741B43359912 of 24.50 (claimed with the recorded sample) |
| 2:18 | Agents | `/agent`, MCP `preview_price` response, then PayPal's MCP `get_order` reading order 8UL89980VA964960L back |
| 2:35 | Honest limits | GitHub is the first fact source; everyone else pays list price; sandbox only |
| 2:49 | End card | Live URL and repository |

Uploaded Nov 11: https://youtu.be/34leFmtK-iM (2:53; the recorded talk runs over the app's real screens). Submit Devpost by 09:00 Pacific on Thursday.

## Devpost text

**Tagline:** Discounts as proofs, not codes. A checkout priced by code from the buyer's public GitHub record, under a rule the merchant wrote in one sentence; readable by shopping agents.

**Inspiration.** Contributor and open-source discounts usually run on application forms reviewed by hand, or on coupon codes that leak. Unlike a transferable code, eligibility here is checked against the GitHub account the buyer signs in with, and a shopping agent can read the published rule and preview a price without hunting for a code or filling in a form. It does not stop account sharing or manufactured activity.

**What it does.** A merchant writes a discount rule in one sentence, AI red-teams it before launch, and PayPal charges, or refunds, exactly what code computes from the buyer's public GitHub record. Four verbs: **write, hunt, prove, pay** (or pay, then prove).
- *Write:* one sentence, or a form with no AI. A live model proposes a typed rule over six GitHub facts; code validates it and writes the plain-English read-back.
- *Hunt:* before publishing, the AI proposes ways to game the rule; code searches real public accounts for them, re-checks every example, proposes a tightening it has verified, and shows a cost preview with a before/after table. (On the hosted demo the Brief example's hunt is a recorded, dated result; a live hunt runs for other rules, capped.)
- *Prove:* a signed-in buyer (GitHub, no OAuth scopes requested) is priced from public GitHub facts fetched when the quote is created; a sample profile uses a labelled, dated snapshot instead and demonstrates pricing without verifying anyone. Code evaluates the rule and the price ticks down line by line, with links to the deciding pull requests when signed in.
- *Pay:* PayPal charges exactly the earned price, with the discount as its own line. The receipt is read back from PayPal and checks a hash of the facts against the order. A guest who paid full price can prove later and get the exact difference refunded.
- *For agents:* a read-only MCP interface lets an agent read a rule, preview what a buyer would pay and fetch the checkout link for a published rule. It cannot create an order or pay.

**What is new, stated carefully.** Verified-attribute discounts exist (student and OSS verification services; GitHub-login contributor coupons from the Linux Foundation and Gatsby). We did not find a product with all three of: a merchant-written rule over graded facts that computes a price, an automatic exact refund after later proof, and adversarial loophole hunting before launch. We built those, plus a machine-readable rule an agent can query.

**How we built it.** Next.js 16 and TypeScript, Postgres on Neon, Render, PayPal Orders v2 and Payments v2 (sandbox): discount line item, a code-written order description, idempotent capture and refund with stored request ids, `custom_id` binding the fact hash, `note_to_payer` on refunds, and a reconcile path that reads PayPal before changing state. The rule engine, pricing, redemption limit and money state machine are deterministic code with compare-and-set transitions. The model only proposes. The agent interface is read-only by design; to read an order back, the same agent uses PayPal's own MCP server (`@paypal/mcp`), limited to its one read-only tool, `get_order`, against the sandbox.

**AI tools used.** Claude Opus 5.5 (planning, integration, simulated judging), Claude Sonnet 5.5 (research, implementation, independent test authoring, simulated judging), Claude Haiku 5.5 (test and lint runs, simulated judging), Claude Fable (architecture reviews, red-team, strategy and market research, simulated judging), Claude Opus 4.6 Thinking (simulated judging), Gemini 3.8 Flash (architecture critic, author of the held-out compiler test sentences, simulated judging), Gemma 4 12B on Ollama (development-time compiler and the held-out evaluation). **At runtime the deployed demo uses DeepSeek V4.1 Flash on Nebius Token Factory** as the rule compiler and loophole proposer: it receives the merchant's sentence (to compile) or the rule's plain-English read-back (to hunt), never a price, a buyer's identity or a buyer's facts; every answer is validated by code, and recorded results are the fallback for the example sentences. GPT models were planned but unavailable and are not credited.

**Challenges.** Keeping AI away from money. Making refunds and captures safe under retries, timeouts and double clicks. Making "recorded" and "live" honest everywhere. Independent reviews kept finding real problems (stuck captures, a reconcile path that skipped the redemption claim, a refund id reuse, a refund priced under a buyer-published rule); each became a regression test.

**Accomplishments.** Every money feature has a row of real sandbox evidence read back from PayPal: discounted capture, idempotent refunds, buy-then-refund with `note_to_payer`, and on the deployed site two purchases signed in with a real GitHub account, one at list price and one with a 20% discount earned from live facts and shown as its own discount line in PayPal's record. 920 automated tests (893 run without a database; the other 27 are the Postgres-backed money-path tests), an AI-assisted red-team review of the local app (no approved payments or GitHub sign-in exercised; not an external audit), and simulated judging by AI models with the findings published. A held-out compiler evaluation scored 26/29, below our own pre-set bar of 27, and is published as a fail along with the fix and the re-runs (`docs/process/L5b-heldout-first-run.md`).

**Honest limits.** GitHub is the only fact source. Rules are per browser or shared by link; there are no merchant accounts. Refunding after the fact does not return PayPal's fee (about $0.85 more on the $49 example). This is a merchant-chosen thank-you: everyone the rule does not cover pays list price, and the default rule excludes maintainers' own repositories, a known flaw of that rule. Public facts are read live from GitHub, not verified true; small pull requests and aged accounts can pass, and the hunt catches the patterns it knows.

**Who pays first, and how they would use it.** Developer-tool and course sellers that already run an open-source or contributor programme by application form. The workflow: the seller writes the rule in one sentence, lets the hunt close the obvious loopholes, and pastes the checkout link into its pricing page or README in place of the application form. Contributors get the discount at checkout with no form and no code; everyone else pays list price; the seller keeps a PayPal-recorded trail of every discount granted.

**Pricing model (a hypothesis, not a built feature).** A small fee per discount granted, or a flat monthly fee per merchant.

**What's next.** Merchants paid into their own PayPal accounts. Authorise at list price and capture the earned price, so no refund and no lost fee. Budget caps, expiry and redemption limits per rule. A "maintains a popular repository" fact and a rolling twelve-month window. More fact sources, starting with package maintainership. An agent that starts checkout while the buyer approves.

**Built with:** Next.js, TypeScript, PayPal REST (Orders v2, Payments v2, JS SDK), GitHub GraphQL and OAuth, Model Context Protocol, PayPal MCP server (`@paypal/mcp`, read-only), Postgres (Neon), Render, Nebius Token Factory (DeepSeek V4.1 Flash), Ollama.

**Demo video.** https://youtu.be/34leFmtK-iM (2:53)

**Try it.** https://earned-price.onrender.com (PayPal sandbox only; no real money).
- *Buyer:* open the shop, pick a sample or sign in with GitHub, and pay with the sandbox buyer shown on the page under "Sandbox buyer for judges" (its email and password are printed there). Inside the PayPal window the buyer pays from its sandbox balance. Each GitHub account redeems once in total and each sample profile once per browser; the page has a demo-only reset.
- *Merchant:* https://earned-price.onrender.com/merchant: click Brief example, Compile, Hunt for loopholes, Apply tightening, then Publish for a checkout link. Or type your own sentence: a live model compiles it (capped; up to two minutes). Or build a rule by hand with no AI.
- *Agent:* https://earned-price.onrender.com/agent: a read-only MCP server with a curl example on the page.
Test access stays up through Dec 15.

**Not part of the pasted text, submission form only:** tick the Render sponsor prize (the service is deployed from the repository's `render.yaml`); list the AI tools above in the AI-tools field; make the YouTube video public; if the form has a testing-instructions field, paste the sandbox buyer's email and password from the page there.
