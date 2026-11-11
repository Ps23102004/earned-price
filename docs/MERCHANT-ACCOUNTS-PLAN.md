# Merchant accounts: plan (not built)

Status: planned, to be built after the Nov 12 2026 submission. Nothing here is in the live app.

## Why not now

Today a rule belongs to the browser that published it, and every sale settles to one sandbox business account. Accounts touch the session, the rules table and every route that reads `activeRuleId`, one day before the deadline and with the money path already proven. Judging runs to Dec 15, so the site stays frozen. This file is the design to build next.

## Two separate things: accounts and payouts

| | Accounts (buildable now) | Payouts to the merchant's own PayPal (not buildable without PayPal) |
|---|---|---|
| What | A merchant signs in, owns rules, sees their orders | Sales settle to the merchant's PayPal Business account |
| Needs | Our own DB and sign-in | PayPal Commerce Platform partner approval, partner referrals onboarding, `payee.merchant_id` on each purchase unit, optional platform fee |
| Sandbox today | Yes | No: onboarding third-party sellers needs partner credentials we do not have |

Phase 1 is accounts only and says plainly that sales still settle to the one sandbox business account. Phase 2 is payouts and is blocked on PayPal.

## Phase 1: merchant accounts

**Identity.** A merchant is a GitHub sign-in with a separate role from a buyer. Same OAuth app, zero scopes, but a different entry point (`/merchant/login`) and a different sealed-session field (`merchantId`), so being signed in as a buyer never grants merchant access and the reverse. One person can hold both; the two flows never read each other's field.

**Data (migration, additive only):**
- `merchants(id uuid pk, github_id bigint unique, login text, created_at)`.
- `rules.merchant_id uuid null references merchants`. Null = legacy session-published rule, which keeps working.
- `rules.status text` (`published | archived`), `rules.title text null`.
- `orders` unchanged: its `rule_id` already links an order to a merchant.

**Routes (every one checks `session.merchantId` and ownership of the rule):**
- `POST /api/merchant/login` flow: callback creates or finds the merchant row.
- `GET /api/merchant/rules`: my rules.
- `POST /api/merchant/rules/{id}/publish`, `/archive`: publish only to my own account; an archived rule's checkout link shows "no longer available" and prices at the default rule.
- `GET /api/merchant/orders`: orders under my rules.
- Existing publish route: when signed in as a merchant, saves the rule to the account; when not, behaves as today.

**Pages:** `/merchant` gains a signed-in state: my rules (title, read-back, status, checkout link, copy), and a dashboard: orders, discounts granted (cents), refunds, redemptions, average discount, each order linking to its receipt. Totals come from our database and are labelled so; per-order money figures stay on the receipt, read back from PayPal.

**Controls a merchant expects:** redemption cap per rule, an optional budget (stop discounting after N cents given, then list price), and archive. These live in `rules` and are enforced in `price()`'s caller at quote time, never by the model.

**Unchanged on purpose:** capture, refund, reconcile, redemption and the receipt hash. Phase 1 adds no code to the money state machine.

**Security:**
- Ownership check on every merchant route, tested with two merchants.
- Origin check and rate limits as on the other POST routes.
- A buyer-role session cannot call a merchant route, and the reverse.
- The dashboard shows only orders under the merchant's own rules, and no buyer identity beyond what the receipt already shows.
- Nothing from the browser sets a price; a rule's cap or budget is read from the database.

**Tests:** two-merchant isolation, role separation, archive behaviour, cap and budget at quote time, dashboard totals against known orders, migration on a database that already has orders (legacy rules untouched).

**Acceptance:** merchant A signs in, publishes a rule, a buyer pays under it, A's dashboard shows that order and discount; merchant B sees none of it; a buyer-only session gets 401 on merchant routes; full test suite, lint, typecheck and build pass; live smoke on the deployed site; the README and limits say that sales still settle to one sandbox business account.

**Estimate:** about one working day including tests and a live check.

## Phase 2: payouts (blocked on PayPal)

1. Apply for PayPal Commerce Platform partner access.
2. Merchant onboarding by partner referral; store the returned PayPal merchant id on the `merchants` row.
3. Create orders with `purchase_units[].payee.merchant_id` set to that id, and `payment_instruction.platform_fees` if a fee is wanted. Refunds then run against the merchant's capture and need the matching authorization header.
4. Re-run the money proofs (discounted capture, idempotent refund, refund-after-proof) against a seller account, since fees, who pays the refund and reconciliation change.
5. Update the limits: refunds still do not return PayPal's fee.

## Open questions

- Whether a rule with a null `merchant_id` should stay publishable after accounts exist (current plan: yes, as a "guest merchant" path).
- Whether the budget counts discounts only on captured orders (current plan: yes).
