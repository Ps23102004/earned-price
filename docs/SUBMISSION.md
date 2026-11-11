# Submission pack: video script and Devpost text

Claims match the repository and the live site as of Nov 11. Re-check `docs/EVIDENCE.md` before recording. PayPal is sandbox only; say so on screen. Judges may stop watching at about 3 minutes and may score from the video and text alone, so the first 60–90 seconds must carry the pitch.

## Recording rules (from walking the live site)
- Record https://earned-price.onrender.com, clean browser profile, 1080p. Do not type the sandbox buyer's password on camera, and never show `.env`, keys, the test count or the review documents.
- **Live caps:** 10 live compiles per hour per address and 3 live hunts per hour. Rehearse on the recorded example (free, instant) and spend a live compile only on the real take.
- **A live-compiled sentence has no recorded loophole hunt.** The self-merge finding exists for the **brief example** (a recorded result, labelled with its date). Use the Brief example for the hunt scene; use a new sentence only for the "live compile" scene.
- **The GitHub sign-in scene needs a rule your account genuinely meets**, or the price stays $49.00. Before recording, build a rule by hand with a tier your account satisfies (account age or public repositories), publish it, and use that link. Otherwise show the "Qualifies" sample for the price ticking down.
- Each GitHub account or sample profile redeems once: use the demo-only reset between takes.
- Do not show the 1Password page or any third-party logo. Say "application forms", not a company name.

## Video script (target 2:40, hard limit 3:00)

| Time | On screen | Say |
|---|---|---|
| 0:00 | The shop: the price ticks from $49.00 down to the earned price, the PayPal button visible, "PayPal sandbox" caption | "This checkout has no coupon box. The price is earned from public GitHub facts. AI writes the rule, code enforces it, and PayPal charges exactly what you earned." |
| 0:12 | Text overlay on `/merchant`: "Today: application forms and leaked coupon codes" | "Open-source discounts run on applications reviewed by hand, or on codes that leak." |
| 0:20 | Type a **new** sentence, Compile, "Live model" chip, rule JSON beside the read-back | "A merchant writes one sentence. A live model proposes a typed rule; code validates it and writes the read-back. The model never sees a price." |
| 0:38 | Click the "Students" example, the refusal appears | "It refuses what it cannot check." |
| 0:44 | Click "Brief example", Hunt for loopholes (the recorded-result label stays visible), the self-merge finding with plain-English facts, Apply tightening, then the Before/After cost table | "Before launch it hunts for accounts that win against the rule's spirit. Closing this one saves about $580 per thousand sales on this sample." |
| 1:05 | Publish and get a checkout link, Copy | "Publishing gives a checkout link." |
| 1:10 | **Second browser:** open the link, sign in with GitHub, the price ticks down, PayPal approval, the receipt | "The buyer proves public facts with zero permissions. PayPal charges exactly that, and every figure on the receipt is read back from PayPal." |
| 1:45 | Guest pays $49.00, claims a refund with a sample, the receipt shows $24.50 refunded | "Or buy first and prove later. Code refunds the exact difference through PayPal." |
| 2:10 | An agent client (Claude Code, or a terminal call if none is available) calls `preview_price`, gets the price and the checkout link | "An agent can't guess a coupon. Here it reads the rule and previews the price. It can't pay: the buyer stays in charge of approving." |
| 2:35 | End card: live URL, repo, "PayPal sandbox only" | "AI proposes. Code decides. PayPal records." |

Optional 8-second beat after the cost table: "Or build a rule by hand, no AI", build a two-tier rule, publish. If the PayPal popup is awkward to capture, record the approval separately and cut it in. Upload to YouTube as **public** (not unlisted) 2–3 hours before the deadline.

## Devpost text

**Tagline:** Discounts you earn from public facts, not codes you find. Readable by agents too.

**Inspiration.** Contributor and open-source discounts usually run on application forms reviewed by hand, or on coupon codes that leak. Public GitHub facts can't be shared like a coupon, anyone can check them, and a shopping agent can read a rule where it cannot guess a code.

**What it does.** Four verbs: **write, hunt, prove, pay** (or pay, then prove).
- *Write:* a merchant types one sentence, or builds a rule by hand with no AI. A live model proposes a typed rule over six GitHub facts; code validates it and writes the plain-English read-back.
- *Hunt:* before publishing, it looks for real anonymised accounts that win a tier against the rule's spirit, proposes a tightening that code recomputes and checks, and shows a cost preview with a before/after table.
- *Prove:* the buyer signs in with GitHub (no OAuth scopes) or picks a recorded sample; code evaluates the rule and the price ticks down line by line, with links to the deciding pull requests when signed in with GitHub.
- *Pay:* PayPal charges exactly the earned price, with the discount as its own line. The receipt is read back from PayPal and checks a hash of the facts. A guest who paid full price can prove later and get the exact difference refunded.
- *For agents:* a read-only MCP interface lets an agent read a rule, preview what a buyer would pay and fetch the checkout link. It cannot create an order or pay.

**What is new, stated carefully.** Verified-attribute discounts exist (student and OSS verification services; GitHub-login contributor coupons). We did not find a product with all three of: a merchant-written rule over graded facts that computes a price, an automatic exact refund after later proof, and adversarial loophole hunting before launch. We built those, plus a machine-readable rule an agent can query.

**How we built it.** Next.js 16 and TypeScript, Postgres on Neon, Render, PayPal Orders v2 and Payments v2 (sandbox): discount line item, a code-written order description, idempotent capture and refund with stored request ids, `custom_id` binding the fact hash, `note_to_payer` on refunds, and a reconcile path that reads PayPal before changing state. The rule engine, pricing, redemption limit and money state machine are deterministic code with compare-and-set transitions. The model only proposes.

**AI tools used.** Claude Opus 5.5 (planning, integration), Claude Sonnet 5.5 (research, implementation, independent test authoring), Claude Haiku 5.5 (test and lint runs, simulated judging), Claude Fable (architecture reviews, red-team, strategy), Gemini 3.8 Flash (architecture critic, test-sentence author, simulated judging), Gemma 4 12B on Ollama (development-time compiler and the held-out evaluation). **At runtime the deployed demo uses DeepSeek V4.1 Flash on Nebius Token Factory** as the rule compiler and loophole proposer: only the merchant's sentence is sent, every answer is validated by code, and recorded results are the fallback. GPT models were planned but unavailable and are not credited.

**Challenges.** Keeping AI away from money. Making refunds and captures safe under retries, timeouts and double clicks. Making "recorded" and "live" honest everywhere. Independent reviews kept finding real problems (stuck captures, a reconcile path that skipped the redemption claim, a refund id reuse, a refund priced under a buyer-published rule); each became a regression test.

**Accomplishments.** Every money feature has a row of real sandbox evidence read back from PayPal, including a refund with `note_to_payer` and two purchases on the deployed site signed in with a real GitHub account: one at list price and one with a 20% discount earned from live GitHub facts, shown as its own discount line in PayPal's record. About 900 automated tests, an independent red-team review, and simulated judging by AI models with the findings published. A held-out compiler evaluation: 26/29 on sentences the prompt never saw, measured on the local development model, not the hosted one; the failures and the fix are published.

**Honest limits, in three lines.** GitHub is the only fact source. Rules are per browser or shared by link, with no merchant accounts. Refunding after the fact does not return PayPal's fee (about $0.85 more on the $49 example).

**Who pays first.** Developer-tool and course sellers that already run a manual open-source or contributor programme.

**Pricing model (a hypothesis, not a built feature).** A small fee per verified discount, or a flat monthly fee per merchant.

**What's next.** Merchant accounts and a persistent published rule; more proof sources than GitHub; PayPal webhooks for pending payments; authorise at list price and capture the earned price.

**Built with:** Next.js, TypeScript, PayPal REST (Orders v2, Payments v2, JS SDK), GitHub GraphQL and OAuth, Model Context Protocol, Postgres (Neon), Render, Nebius Token Factory (DeepSeek V4.1 Flash), Ollama.

**Try it.** https://earned-price.onrender.com (PayPal sandbox only). Open the shop, pick a sample, and pay with the sandbox buyer shown on the page: [paste the sandbox buyer email and password here, copied from the site]. Each GitHub account or sample profile redeems once; the page has a demo-only reset. Test access stays up through Dec 15.
