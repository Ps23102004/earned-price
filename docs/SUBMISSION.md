# Submission pack: video script and Devpost text

Claims match the repository and the live site as of Nov 11. PayPal is sandbox only; say so on screen. The site must stay up, with working credentials, until Dec 15 2026, 8:00 AM PT.

## Video script (2:45, hard limit 3:00)

Recorded on the live site; waits (compile, sign-in, PayPal login) are cut.

| Time | On screen | Say |
|---|---|---|
| 0:00 | The live shop: click "Price this sample" on Qualifies, the price ticks from $49.00 down to $24.50, the PayPal button in frame, caption "PayPal sandbox" | "No coupon box here. Your price comes from your public GitHub record, under a rule the merchant wrote in one sentence. PayPal charges, or refunds, exactly that." |
| 0:12 | `/merchant`, click Brief example, Compile ("Recorded result" chip visible), then Hunt for loopholes: the Self-Merging finding with three anonymised accounts, Apply tightening, the Before/After cost table. Captions: "Recorded example, Nov 10" and "42-account illustrative sample, not a forecast" | "Open-source discounts run on hand-reviewed applications or leaky codes. Here the AI attacks the merchant's rule before launch. In this recorded example, three real accounts win 20% off by merging into their own repos. Code re-checks them and recomputes the fix, and the preview flags a rule that works like a blanket price cut." |
| 0:45 | Type a new sentence (with "20% off for accounts at least one year old"), Compile, "Live model" chip, rule JSON beside the read-back. Caption: "the model never sees a price" | "Now your own sentence. A live model proposes a typed rule; code validates it and writes the read-back. The model never sees a price." |
| 1:05 | Publish and get a checkout link, Copy. Second browser: open the link, click "Start checkout under this rule", sign in with GitHub (no permissions), the price ticks to $39.20, PayPal approval, the receipt | "Publishing gives a checkout link. The buyer proves who they are with zero permissions; code reads their public facts live. PayPal charges exactly that, and every figure on the receipt is read back from PayPal." |
| 1:45 | Fresh browser: guest pays $49.00, claims a refund on the receipt with the Qualifies sample, the receipt shows $24.50 refunded | "Or buy first and prove later. Code refunds the exact difference through PayPal." |
| 2:10 | An agent client (Claude Code with the MCP server added, or one terminal call) runs `preview_price` with the **published rule id** and a public login: the response carries the price and the checkout link together | "An agent can't guess a coupon. Here it reads the rule, previews the price for a public login and gets the checkout link. It can't pay, by design: the buyer stays in charge of approving." |
| 2:35 | End card: live URL, repo, "GitHub is the first fact source. List price for everyone else. PayPal sandbox only." | "Discounts as proofs, not codes." |

Upload to YouTube as **public** (not unlisted) two to three hours before the deadline; submit Devpost by 09:00 Pacific on Thursday.

## Devpost text

**Tagline:** Discounts as proofs, not codes. A checkout priced by code from the buyer's public GitHub record, under a rule the merchant wrote in one sentence; readable by shopping agents.

**Inspiration.** Contributor and open-source discounts usually run on application forms reviewed by hand, or on coupon codes that leak. Unlike a transferable code, eligibility here is checked against the GitHub account the buyer signs in with, and a shopping agent can read the published rule and preview a price without hunting for a code or filling in a form. It does not stop account sharing or manufactured activity.

**What it does.** A merchant writes a discount rule in one sentence, AI red-teams it before launch, and PayPal charges, or refunds, exactly what code computes from the buyer's public GitHub record. Four verbs: **write, hunt, prove, pay** (or pay, then prove).
- *Write:* one sentence, or a form with no AI. A live model proposes a typed rule over six GitHub facts; code validates it and writes the plain-English read-back.
- *Hunt:* before publishing, the AI proposes ways to game the rule; code searches real public accounts for them, re-checks every example, proposes a tightening it has verified, and shows a cost preview with a before/after table. (On the hosted demo the Brief example's hunt is a recorded, dated result; a live hunt runs for other rules, capped.)
- *Prove:* a signed-in buyer (GitHub, no OAuth scopes requested) is priced from public GitHub facts fetched when the quote is created; a sample profile uses a labelled, dated snapshot instead and demonstrates pricing without verifying anyone. Code evaluates the rule and the price ticks down line by line, with links to the deciding pull requests when signed in.
- *Pay:* PayPal charges exactly the earned price, with the discount as its own line. The receipt is read back from PayPal and checks a hash of the facts against the order. A guest who paid full price can prove later and get the exact difference refunded.
- *For agents:* a read-only MCP interface lets an agent read a rule, preview what a buyer would pay and fetch the checkout link. It cannot create an order or pay.

**What is new, stated carefully.** Verified-attribute discounts exist (student and OSS verification services; GitHub-login contributor coupons from the Linux Foundation and Gatsby). We did not find a product with all three of: a merchant-written rule over graded facts that computes a price, an automatic exact refund after later proof, and adversarial loophole hunting before launch. We built those, plus a machine-readable rule an agent can query.

**How we built it.** Next.js 16 and TypeScript, Postgres on Neon, Render, PayPal Orders v2 and Payments v2 (sandbox): discount line item, a code-written order description, idempotent capture and refund with stored request ids, `custom_id` binding the fact hash, `note_to_payer` on refunds, and a reconcile path that reads PayPal before changing state. The rule engine, pricing, redemption limit and money state machine are deterministic code with compare-and-set transitions. The model only proposes. The agent interface is read-only by design, and we did not use PayPal's Agent Toolkit.

**AI tools used.** Claude Opus 5.5 (planning, integration, simulated judging), Claude Sonnet 5.5 (research, implementation, independent test authoring, simulated judging), Claude Haiku 5.5 (test and lint runs, simulated judging), Claude Fable (architecture reviews, red-team, strategy and market research, simulated judging), Claude Opus 4.6 Thinking (simulated judging), Gemini 3.8 Flash (architecture critic, author of the held-out compiler test sentences, simulated judging), Gemma 4 12B on Ollama (development-time compiler and the held-out evaluation). **At runtime the deployed demo uses DeepSeek V4.1 Flash on Nebius Token Factory** as the rule compiler and loophole proposer: it receives the merchant's sentence (to compile) or the rule's plain-English read-back (to hunt), never a price, a buyer's identity or a buyer's facts; every answer is validated by code, and recorded results are the fallback for the example sentences. GPT models were planned but unavailable and are not credited.

**Challenges.** Keeping AI away from money. Making refunds and captures safe under retries, timeouts and double clicks. Making "recorded" and "live" honest everywhere. Independent reviews kept finding real problems (stuck captures, a reconcile path that skipped the redemption claim, a refund id reuse, a refund priced under a buyer-published rule); each became a regression test.

**Accomplishments.** Every money feature has a row of real sandbox evidence read back from PayPal: discounted capture, idempotent refunds, buy-then-refund with `note_to_payer`, and on the deployed site two purchases signed in with a real GitHub account, one at list price and one with a 20% discount earned from live facts and shown as its own discount line in PayPal's record. About 900 automated tests, an AI-assisted red-team review of the local app (no approved payments or GitHub sign-in exercised; not an external audit), and simulated judging by AI models with the findings published. A held-out compiler evaluation: 26/29 on sentences the prompt never saw, below our own pre-set bar of 27 and recorded as a fail, measured on the local development model, not the hosted one; the failures and the fix are published.

**Honest limits.** GitHub is the only fact source. Rules are per browser or shared by link; there are no merchant accounts. Refunding after the fact does not return PayPal's fee (about $0.85 more on the $49 example). This is a merchant-chosen thank-you: everyone the rule does not cover pays list price, and the default rule excludes maintainers' own repositories, a known flaw of that rule. Public facts are read live from GitHub, not verified true; small pull requests and aged accounts can pass, and the hunt catches the patterns it knows.

**Who pays first, and how they would use it.** Developer-tool and course sellers that already run an open-source or contributor programme by application form. The workflow: the seller writes the rule in one sentence, lets the hunt close the obvious loopholes, and pastes the checkout link into its pricing page or README in place of the application form. Contributors get the discount at checkout with no form and no code; everyone else pays list price; the seller keeps a PayPal-recorded trail of every discount granted.

**Pricing model (a hypothesis, not a built feature).** A small fee per discount granted, or a flat monthly fee per merchant.

**What's next.** Merchants paid into their own PayPal accounts. Authorise at list price and capture the earned price, so no refund and no lost fee. Budget caps, expiry and redemption limits per rule. A "maintains a popular repository" fact and a rolling twelve-month window. More fact sources, starting with package maintainership. An agent that starts checkout while the buyer approves.

**Built with:** Next.js, TypeScript, PayPal REST (Orders v2, Payments v2, JS SDK), GitHub GraphQL and OAuth, Model Context Protocol, Postgres (Neon), Render, Nebius Token Factory (DeepSeek V4.1 Flash), Ollama.

**Try it.** https://earned-price.onrender.com (PayPal sandbox only; no real money).
- *Buyer:* open the shop, pick a sample or sign in with GitHub, and pay with the sandbox buyer shown on the page under "Sandbox buyer for judges" (email and password: [paste them here before submitting]). Inside the PayPal window the buyer pays from its sandbox balance. Each GitHub account redeems once in total and each sample profile once per browser; the page has a demo-only reset.
- *Merchant:* https://earned-price.onrender.com/merchant: click Brief example, Compile, Hunt for loopholes, Apply tightening, then Publish for a checkout link. Or type your own sentence: a live model compiles it (capped; up to two minutes). Or build a rule by hand with no AI.
- *Agent:* https://earned-price.onrender.com/agent: a read-only MCP server with a curl example on the page.
Test access stays up through Dec 15.

**Not part of the pasted text, submission form only:** tick the Render sponsor prize (the service is deployed from the repository's `render.yaml`); list the AI tools above in the AI-tools field; make the YouTube video public.
