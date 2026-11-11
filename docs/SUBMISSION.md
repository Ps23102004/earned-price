# Submission pack: video script and Devpost text

Claims match the repository and the live site as of Nov 11. PayPal is sandbox only; say so on screen. Judges may stop at three minutes and may score from the video and the text alone, so the first 60–90 seconds carry the pitch. Submission text and video lock at the deadline; the site must stay up, with working credentials, until Dec 15 2026, 8:00 AM PT.

## Recording rules (from walking the live site)

- Record https://earned-price.onrender.com, clean browser profile, 1080p. Never type the sandbox buyer's password on camera; never show `.env`, keys, the test count or the review documents.
- **Caps:** 10 live compiles per hour per address, 3 live hunts per hour. Rehearse on the recorded Brief example (free, instant); spend a live compile only on the real take.
- **Order of the merchant beats matters.** The loophole hunt exists as a recorded result for the **Brief example** only; a sentence you type has no recorded hunt. So: hunt on the Brief example first, then type your own sentence and compile it live, then publish *that* rule.
- **The rule you publish must have a tier your GitHub account meets**, or the buyer scene shows $49.00 with every tier failed. Include "20% off for accounts at least one year old" in the sentence you type (an account 561 days old meets it; the evidence log shows this exact purchase).
- **The prove-later scene must run under the default rule** to show $24.50 refunded on the Qualifies sample. Use a fresh browser or private window for it, or click "Use the default rule instead" on the shop banner first.
- Each GitHub account or sample profile redeems once per browser: use the demo-only reset between takes.
- No company names or logos on screen; say "application forms".
- **Test access:** the primary sandbox buyer is on the site in judge mode. A backup buyer exists (`sb-backup-buyer-20261111@personal.example.com`, $10,000 balance, a linked Visa and a bank account) but its password is not known: set one in the PayPal developer dashboard before putting it anywhere. Say "can fund with a linked card or bank inside the PayPal window", not "pay with a test card".

## Video script (2:45, hard limit 3:00)

| Time | On screen | Say |
|---|---|---|
| 0:00 | The live shop: the price ticks from $49.00 down to $24.50, the PayPal button in frame, caption "PayPal sandbox" | "This checkout has no coupon box. Your price comes from your public GitHub record, under a rule the merchant wrote in one sentence. PayPal charges, or refunds, exactly that." |
| 0:12 | `/merchant`, click Brief example, Compile ("Recorded result" chip visible), then Hunt for loopholes: the Self-Merging finding with three anonymised accounts, Apply tightening, the Before/After cost table. Caption: "42-account illustrative sample" | "Open-source discounts run on applications reviewed by hand, or on codes that leak. Here the merchant writes the rule in a sentence and the AI attacks it before launch: these three accounts would win 20% off by merging into their own repositories. Code checks every example and recomputes the fix. Closing this one saves about $580 per thousand sales on this sample." |
| 0:45 | Type a new sentence (with "20% off for accounts at least one year old"), Compile, "Live model" chip, rule JSON beside the read-back. Caption: "the model never sees a price" | "Now your own sentence. A live model proposes a typed rule; code validates it and writes the read-back. The model never sees a price." |
| 1:05 | Publish and get a checkout link, Copy. Second browser: open the link, sign in with GitHub (no permissions), the price ticks to $39.20, PayPal approval, the receipt | "Publishing gives a checkout link. The buyer proves public facts with zero permissions, checked at sign-in. PayPal charges exactly that, and every figure on the receipt is read back from PayPal." |
| 1:45 | Fresh browser: guest pays $49.00, claims a refund with the Qualifies sample, the receipt shows $24.50 refunded | "Or buy first and prove later. Code refunds the exact difference through PayPal." |
| 2:10 | An agent client (Claude Code with the MCP server added, or a terminal call) runs `preview_price` for a public login and gets the price and the checkout link | "An agent can't guess a coupon. Here it reads the rule and previews the price. It can't pay, by design: the buyer stays in charge of approving." |
| 2:35 | End card: live URL, repo, "GitHub is the first fact source. List price for everyone else. PayPal sandbox only." | "Discounts as proofs, not codes." |

If the PayPal popup is awkward to capture, record the approval separately and cut it in. Upload to YouTube as **public** (not unlisted) two to three hours before the deadline; submit Devpost by 09:00 Pacific on Thursday.

## Devpost text

**Tagline:** Discounts as proofs, not codes. A checkout priced by code from the buyer's public GitHub record, under a rule the merchant wrote in one sentence; readable by shopping agents.

**Inspiration.** Contributor and open-source discounts usually run on application forms reviewed by hand, or on coupon codes that leak. Public GitHub facts can't be shared like a coupon, anyone can check them, and a shopping agent can read a published rule where it cannot fill in a form or guess a code.

**What it does.** A merchant writes a discount rule in one sentence, AI red-teams it before launch, and PayPal charges, or refunds, exactly what code computes from the buyer's public GitHub record. Four verbs: **write, hunt, prove, pay** (or pay, then prove).
- *Write:* one sentence, or a form with no AI. A live model proposes a typed rule over six GitHub facts; code validates it and writes the plain-English read-back.
- *Hunt:* before publishing, the AI proposes ways to game the rule; code searches real public accounts for them, checks every example, proposes a tightening it has verified, and shows a cost preview with a before/after table.
- *Prove:* the buyer signs in with GitHub (no OAuth scopes) or picks a recorded sample; code evaluates the rule on public facts checked at sign-in, and the price ticks down line by line, with links to the deciding pull requests when signed in.
- *Pay:* PayPal charges exactly the earned price, with the discount as its own line. The receipt is read back from PayPal and checks a hash of the facts against the order. A guest who paid full price can prove later and get the exact difference refunded.
- *For agents:* a read-only MCP interface lets an agent read a rule, preview what a buyer would pay and fetch the checkout link. It cannot create an order or pay.

**What is new, stated carefully.** Verified-attribute discounts exist (student and OSS verification services; GitHub-login contributor coupons from the Linux Foundation and Gatsby). We did not find a product with all three of: a merchant-written rule over graded facts that computes a price, an automatic exact refund after later proof, and adversarial loophole hunting before launch. We built those, plus a machine-readable rule an agent can query.

**How we built it.** Next.js 16 and TypeScript, Postgres on Neon, Render, PayPal Orders v2 and Payments v2 (sandbox): discount line item, a code-written order description, idempotent capture and refund with stored request ids, `custom_id` binding the fact hash, `note_to_payer` on refunds, and a reconcile path that reads PayPal before changing state. The rule engine, pricing, redemption limit and money state machine are deterministic code with compare-and-set transitions. The model only proposes. The agent interface is read-only by design, and we did not use PayPal's Agent Toolkit.

**AI tools used.** Claude Opus 5.5 (planning, integration), Claude Sonnet 5.5 (research, implementation, independent test authoring), Claude Haiku 5.5 (test and lint runs, simulated judging), Claude Fable (architecture reviews, red-team, strategy and market research), Gemini 3.8 Flash (architecture critic, test-sentence author, simulated judging), Gemma 4 12B on Ollama (development-time compiler and the held-out evaluation). **At runtime the deployed demo uses DeepSeek V4.1 Flash on Nebius Token Factory** as the rule compiler and loophole proposer: only the merchant's sentence is sent, every answer is validated by code, and recorded results are the fallback. GPT models were planned but unavailable and are not credited.

**Challenges.** Keeping AI away from money. Making refunds and captures safe under retries, timeouts and double clicks. Making "recorded" and "live" honest everywhere. Independent reviews kept finding real problems (stuck captures, a reconcile path that skipped the redemption claim, a refund id reuse, a refund priced under a buyer-published rule); each became a regression test.

**Accomplishments.** Every money feature has a row of real sandbox evidence read back from PayPal: discounted capture, idempotent refunds, buy-then-refund with `note_to_payer`, and on the deployed site two purchases signed in with a real GitHub account, one at list price and one with a 20% discount earned from live facts and shown as its own discount line in PayPal's record. About 900 automated tests, an independent red-team review, and simulated judging by AI models with the findings published. A held-out compiler evaluation: 26/29 on sentences the prompt never saw, measured on the local development model (not the hosted one); the failures and the fix are published.

**Honest limits.** GitHub is the only fact source. Rules are per browser or shared by link; there are no merchant accounts. Refunding after the fact does not return PayPal's fee (about $0.85 more on the $49 example). This is a merchant-chosen thank-you: everyone the rule does not cover pays list price, and the default rule excludes maintainers' own repositories, a known flaw of that rule. Public facts are checked at sign-in, not verified true; small pull requests and aged accounts can pass, and the hunt catches the patterns it knows.

**Who pays first.** Developer-tool and course sellers that already run a manual open-source or contributor programme.

**Pricing model (a hypothesis, not a built feature).** A small fee per discount granted, or a flat monthly fee per merchant.

**What's next.** Merchants paid into their own PayPal accounts. Authorise at list price and capture the earned price, so no refund and no lost fee. Budget caps, expiry and redemption limits per rule. A "maintains a popular repository" fact and a rolling twelve-month window. More fact sources, starting with package maintainership. An agent that starts checkout while the buyer approves.

**Built with:** Next.js, TypeScript, PayPal REST (Orders v2, Payments v2, JS SDK), GitHub GraphQL and OAuth, Model Context Protocol, Postgres (Neon), Render, Nebius Token Factory (DeepSeek V4.1 Flash), Ollama.

**Try it.** https://earned-price.onrender.com (PayPal sandbox only; no real money). Open the shop, pick a sample or sign in with GitHub, and pay with the sandbox buyer shown on the page: [paste the sandbox buyer email and password here, copied from the site]. Inside the PayPal window the buyer can fund with its balance, a linked card or a bank. Each GitHub account or sample profile redeems once per browser; the page has a demo-only reset. Test access stays up through Dec 15.

**Submission form:** tick the Render sponsor prize (the service is deployed from the repository's `render.yaml`); list the AI tools above in the AI-tools field; make the YouTube video public.
