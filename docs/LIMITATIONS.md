# Limitations, plainly

Everything here is true of the live site at https://earned-price.onrender.com as of Nov 11 2026. If a sentence in the README disagrees with this file, the README is wrong and should be fixed to match.

## What the receipt's hash binds, and what it does not

When an order is created, the app sends PayPal a `custom_id` of `<order id>:<sha256 of the stored fact snapshot>`. The receipt recomputes that hash from the snapshot on file and compares it with the `custom_id` PayPal returns.

| It does show | It does not show |
|---|---|
| The facts the price was computed from are the ones on file for that order, byte for byte | That those facts are true: GitHub's data could be wrong, or manufactured (small PRs, aged or bought accounts) |
| PayPal's order record carries a fingerprint of those facts, so neither side can be swapped afterwards without the receipt reading MISMATCH | Which rule was applied: the rule id lives in our database, not in PayPal's record |
| Every money figure on the receipt is PayPal's (order total, discount line, capture, fee, refund), fetched when the page loads | That the server was honest when it stored the snapshot: a compromised server could store anything and hash that |
| A refund's `custom_id` (`<claim hash>:<our attempt id>`) ties PayPal's refund to the claim's facts and to one attempt, so a retry is never mistaken for an earlier refund | That GitHub's facts were fetched at any particular moment other than the stored `fetchedAt` |

So "Fact hash verified" on the receipt means "the facts read from GitHub when the price was quoted, for the account proven at sign-in, are bound to PayPal's record"; it does not mean "verified true".

## Who the default rule excludes

The shop's default rule gives 50% for a merged PR into a 1,000-star repository this year, 20% for any merged PR, and 10% for an account at least three years old with a public repository. The 50% and 20% tiers exclude pull requests into the author's own repositories and PRs under 10 changed lines, and the 50% tier also excludes forks, because the recorded loophole hunts found real accounts winning those tiers by merging into their own repositories; the small-PR and fork limits were added as precautions, not because the hunt found examples. Consequences:

- The sole maintainer of a popular personal project earns nothing from the top two tiers, only the 10% tier if the account is old enough. That is a known flaw of the default rule, not of the mechanism; a merchant can write a different rule.
- A repository controlled through an organisation the author also controls is invisible to the "not my own repo" check, so self-merges there still count.
- Newcomers, people who work only in private repositories, and people who contribute to open source without a GitHub account pay list price.
- The rule is a merchant-chosen thank-you. Everyone it does not cover pays list price; nobody pays more than list.

## Facts and fairness

- **GitHub is the only fact source**, read with one server token. Live lookups are capped (20 per hour per address at checkout, 10 per hour per address for agents); when GitHub cannot be read or the budget is spent, the quote fails with a message pointing to the sample profiles rather than guessing. More than 300 merged PRs are truncated and flagged.
- **Facts can be manufactured.** Small pull requests, aged or purchased accounts and organisation-owned repositories can all pass. The loophole hunt catches the patterns it knows (self-merges, tiny PRs, forks, brand-new accounts); it does not catch everything, and a rule can still reward spam pull requests that maintainers resent.
- **Pricing by public profile raises fairness and, in some places, legal questions.** The price depends on unpaid public work. Some jurisdictions regulate or require disclosure of algorithmic pricing from personal data; nothing here is legal advice, and a real deployment would need that checked.

## AI

- **The live compiler is a hosted model** (DeepSeek V4.1 Flash on Nebius Token Factory), capped at 10 live compiles per hour per address and 200 per day; live loophole hunts are capped at 3 per hour per address. Beyond the caps, or if the model does not answer, the page says so and the recorded results for the example sentences and the hand-built rule form still work. The model receives the merchant's sentence (to compile) or the rule's plain-English read-back (to hunt), never a price, a buyer's identity or a buyer's facts, and every answer is validated by code.
- **The model budget is prepaid credit with a card behind it** on the owner's account, with no hard stop at zero. The daily cap bounds the spend; `AI_LIVE=0` is the kill switch (recorded results only).
- **The held-out compiler score (26/29) was measured on the local development model** (Gemma 4 12B). The same sentences, after the fixes, scored 29/29 on the hosted model (`docs/process/L5c-heldout-hosted.md`); of those 29, 9 were refused by code before any model call, and the sentences were already used to guide the fixes, so this is not a fresh held-out score. The two later scores (29/29 held-out, 40/40 tuned set) were measured after fixes made in response to the first run, so they are development-set numbers.
- **The AI's job is narrow by design:** it turns a sentence into a rule and proposes loophole strategies; code runs the search, checks every example and decides every price. It does not negotiate, pay, or act for a buyer.

## Merchants, buyers and sessions

- **There are no merchant accounts.** A rule is published to the publisher's own browser and to anyone who opens its checkout link; any visitor can publish any existing rule id to their own browser; all sandbox sales settle to one sandbox business account. A merchant cannot connect their own PayPal account.
- **A refund is always priced under the rule the order was bought under** (or the shop default), never a rule the buyer published later.
- **Refunding after the fact does not return PayPal's fee.** On the $49.00 example the merchant pays $2.20 in fees instead of the $1.35 a $24.50 sale would carry, about $0.85 more. Authorise-at-list, capture-the-earned-price would avoid that; it is on the roadmap, not built.
- **Sample profiles are recorded stand-ins** for GitHub sign-in so judges can try the flow without an account. They are anonymised (no logins, URLs, repository names or exact dates; bucketed counts), but a distinctive account's creation month and bucketed history could still narrow candidates. "One redemption per buyer" is per GitHub account for real sign-ins and per browser session for samples, so a fresh browser can redeem a sample again.
- **Sessions are stateless sealed cookies.** Logging out does not revoke a copied cookie for its lifetime. A receipt is visible only with the cookie of the browser that bought it.
- **Judge mode** shows the sandbox buyer's credentials and a demo-only reset button on purpose. Sandbox only; no real money moves.

## Cost preview

The preview runs the rule over 42 recorded accounts of GitHub developers with a public repository, drawn from three follower bands. It is not a random sample of GitHub and not any merchant's customers, so the share that qualifies and the "given away per 1,000 sales" figure are illustrative, for comparing one rule with another, not forecasts.

## Payments and operations

- **Pending payments or refunds resolve when a page loads or a button is pressed.** There are no webhooks; a pending state can sit until someone looks.
- **Rate limits are in memory, per process,** keyed on the client address as Render's edge reports it, with per-session and shared caps behind them. They reset on every deploy.
- **Hosting is free-tier:** Render sleeps the service after 15 minutes without traffic and takes about a minute to wake; two pingers (UptimeRobot every 5 minutes, GitHub Actions every 10) keep it awake, and both can fail. Neon's free compute budget is spent by purchases, claims and rule actions (compiling, including the recorded examples, building, hunting, previewing, publishing, opening a checkout link, agent rule lookups), never by the health check or the landing page.
- **Credentials that expire:** the GitHub server token on Render was replaced on Nov 11 and now expires Feb 9 2027, after judging ends (Dec 15). The sandbox buyer's password can be changed by any visitor who reads it; a backup buyer exists.
- **Scope the original design left out on purpose:** webhooks, Payouts, disputes, Transaction Search, platform fees, authorise-and-hold, merchant accounts, multiple products, subscriptions, other fact sources. Two items were added after a change-log entry: the shareable checkout link and the read-only agent interface.

See `ARCHITECTURE.md` §3.9 for the December-survival table and the change log at its end for every post-freeze change.
