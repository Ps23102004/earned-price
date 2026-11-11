# Submission pack: video script and Devpost text

Numbers and claims below match the repository today. Re-check against `docs/EVIDENCE.md` before recording. PayPal is sandbox; say so on screen. Judges may only watch the first three minutes and may score from the video and text alone, so the video has to carry the whole story.

## Video script (target 2:45, hard limit 3:00)

Record the **deployed URL**. Clean browser profile, 1080p, sandbox banner visible, dates of anything cached visible. Do not show the sandbox buyer's password field being typed, `.env`, any key, or the test count / review documents (process, not product).

| Time | On screen | Say |
|---|---|---|
| 0:00 | Card: "Open-source discounts run on application forms and coupon codes" with the 1Password open-source programme page behind it | "Open-source discounts today run on application forms reviewed by hand, or on coupon codes that leak. And a shopping agent can't fill in a form or guess a code." |
| 0:15 | `/merchant`: type a **new** sentence, Compile, "live" chip, rule JSON beside the read-back | "A merchant writes one sentence. AI proposes a typed rule; code validates it and writes the plain-English read-back. The model never sees a price." |
| 0:35 | Loophole hunt, the self-merge example, Apply tightening, then the Before/After cost table | "Before launch it hunts for accounts that win against the rule's spirit, and shows what the fix costs. Rough sample, labelled." |
| 0:55 | Publish, "Checkout link", Copy | "Publish gives a checkout link." |
| 1:00 | **Second browser** opens the link; sign in with GitHub (no permissions); price ticks down line by line; PayPal approve | "The buyer proves public facts with zero permissions. Code computes the price. PayPal charges exactly that." |
| 1:30 | Receipt: Paid / Refunded / Net, "as recorded by PayPal", "Fact hash verified" | "Every figure is read back from PayPal, and the receipt checks a hash of the facts against the order PayPal holds." |
| 1:45 | Guest pays $49.00, claims with a sample, receipt shows $24.50 refunded | "Or buy first and prove later. Code refunds the exact difference, through PayPal." |
| 2:10 | `/agent` page, then a terminal or Claude Code calling `preview_price` and getting the price and checkout link | "An agent can't scrape a coupon here. It reads the rule, checks public facts, and hands back a checkout link. It cannot pay: the buyer signs in and approves." |
| 2:35 | End card: URL, repo, "PayPal sandbox only" | "AI proposes. Code decides. PayPal records." |

Optional 8-second beat after the cost table: open "Or build a rule by hand (no AI needed)", build a two-tier rule, publish, show the shop price change.

If the PayPal popup is awkward to capture, record the approval separately and cut it in.

## Devpost text

**Tagline:** Discounts you earn from public facts, not codes you find. Built for buyers and their agents.

**Inspiration.** Programmes like 1Password's open-source programme give free accounts to maintainers, by application form, reviewed by hand. Coupon codes are the other option, and they leak. Public GitHub facts can't be shared like a coupon, anyone can check them, and a shopping agent can read a rule where it cannot guess a code.

**What it does.** Four verbs: **write, hunt, prove, pay** (or pay, then prove).
- *Write:* a merchant types one sentence, or builds a rule by hand. AI proposes a typed rule over six GitHub facts; code validates it and writes the read-back.
- *Hunt:* before publishing, it looks for real accounts that win a tier against the rule's spirit, proposes a tightening that code recomputes, and shows a cost preview with a before/after table.
- *Prove:* the buyer signs in with GitHub (no OAuth scopes) or picks a recorded sample; code evaluates the rule and the price ticks down line by line with a link to every fact.
- *Pay:* PayPal charges exactly the earned price, with the discount as its own line. The receipt is read back from PayPal and checks a hash of the facts. A guest who paid full price can prove later and get the exact difference refunded.
- *For agents:* a read-only MCP interface lets an agent read a rule, preview what a buyer would pay and fetch the checkout link. It cannot create an order or pay.

**What is new, stated carefully.** Verified-attribute discounts exist (student and OSS verification services; GitHub-login contributor coupons). We did not find a product with all three of: a merchant-written rule over graded facts that computes a price, an automatic exact refund after later proof, and adversarial loophole hunting before launch. We built those, and a machine-readable rule an agent can query.

**How we built it.** Next.js 16 and TypeScript, Postgres on Neon, PayPal Orders v2 and Payments v2 (sandbox): discount line item, a code-written order description, idempotent capture and refund with stored request ids, `custom_id` binding the fact hash, `note_to_payer` on refunds, and a reconcile path that reads PayPal before changing state. The rule engine, pricing, redemption limit and money state machine are deterministic code with compare-and-set transitions. The model only proposes.

**AI tools used.** Claude Opus 5.5 (planning, integration), Claude Sonnet 5.5 (research, implementation, independent test authoring), Claude Haiku 5.5 (test and lint runs, judging), Claude Fable (architecture reviews, red-team, strategy), Gemini 3.8 Flash (architecture critic, judging), Gemma 4 12B on Ollama (rule compiler and loophole proposer in development). At runtime the hosted demo uses DeepSeek V4.1 Flash on Nebius Token Factory as the rule compiler and loophole proposer (the merchant's sentence is the only thing sent; every answer is validated by code), with recorded compiles as the fallback. GPT models were planned but unavailable and are not credited.

**Challenges.** Keeping AI away from money. Making refunds and captures safe under retries, timeouts and double clicks. Making "cached" and "recorded" honest everywhere. Independent reviews kept finding real problems (stuck captures, a reconcile path that skipped the redemption claim, a refund id reuse, a refund priced under a buyer-published rule); each became a regression test.

**Accomplishments.** Every money feature has a row of real sandbox evidence read back from PayPal, including a refund with `note_to_payer` and a real GitHub sign-in purchase on the deployed site. About 900 automated tests; a held-out compiler evaluation (26/29 on sentences the prompt never saw, with the failures and the fix published) and an independent red-team and judge panel with their findings published.

**Honest limits, in three lines.** GitHub is the only fact source. Rules are per browser or shared by link, with no merchant accounts. Refunding after the fact does not return PayPal's fee (about $0.85 more on the $49 example).

**Who pays first.** Developer-tool and course sellers that already run a manual open-source or contributor programme.

**Pricing model (a hypothesis, not a built feature).** A small fee per verified discount, or a flat monthly fee per merchant.

**What's next.** Merchant accounts and a persistent published rule; more proof sources than GitHub; a live hosted compiler with caps; PayPal webhooks for pending payments; authorise at list price and capture the earned price.

**Built with:** Next.js, TypeScript, PayPal REST (Orders v2, Payments v2, JS SDK), GitHub GraphQL and OAuth, Model Context Protocol, Postgres (Neon), Render, Ollama.

**Try it.** https://earned-price.onrender.com (sandbox only). The site's judge mode shows a sandbox buyer; credentials: [paste the sandbox buyer email and password here, from the site]. Or pay with the test card shown there. Each GitHub account or sample profile redeems once; use the demo-only reset on the page to repeat. Free test access stays up through Dec 15.
