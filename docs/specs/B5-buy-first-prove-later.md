# B5 — Buy first, prove later (F7): claim a refund after paying full price

Architecture: `docs/ARCHITECTURE.md` §3.5 (Buy first, prove later; reconcileOrder rows `refunding` and `refund_pending`), facts P25–P29. A guest buys at list price; later they prove facts (GitHub sign-in or a sample profile) and the code refunds exactly the difference between what PayPal captured and what the rules now say they should have paid. **Next.js 16 with cacheComponents**: read `node_modules/next/dist/docs/01-app/` before writing routes/pages.

## Hard rules
- AI never involved. Deterministic code computes the amount: `refundCents = capturedCents − earnedNowCents`, `earnedNowCents` from `evaluate` + `price` on fresh facts under the order's rule. The client sends no amount.
- One redemption per buyer applies: a claim takes the buyer's redemption in the same transaction that moves the order to `refunding`.
- Refund never exceeds `captured − earnedNow` (DB check on `refunds`), one live refund per order (partial unique index).
- Every money figure shown after the refund is read back from PayPal (refund object from `GET order` `payments.refunds[]`, or `GET /v2/payments/refunds/{id}`); the refund's `custom_id` must equal the stored claim snapshot hash.
- PayPal sandbox only. Lock held across no PayPal call. Every state change is compare-and-set.

## Pure modules (independent tests are written from this spec)

### `src/store/refund-outcome.ts`
```ts
export const REFUND_REJECT_ISSUES: readonly string[]  // ["REFUND_AMOUNT_EXCEEDED","REFUND_TIME_LIMIT_EXCEEDED","CAPTURE_FULLY_REFUNDED","REFUND_NOT_ALLOWED"]

export function refundDue(capturedCents: number, earnedNowCents: number): number   // max(0, captured − earnedNow); integers only, never NaN/negative

export type RefundInput = { kind: "response"; httpStatus: number; body: any } | { kind: "network_error" };
export type RefundDecision =
  | { kind: "completed"; refundId: string; paypalCents: number }   // COMPLETED, USD, amount == expected
  | { kind: "mismatch"; refundId: string; paypalCents: number | undefined } // COMPLETED but currency != USD or amount != expected
  | { kind: "pending"; refundId: string }                          // PENDING
  | { kind: "rejected"; message: string }                          // PayPal definitively did not refund
  | { kind: "keep" };                                              // unknown / in flight: change nothing
export function decideRefundOutcome(input: RefundInput, expectedCents: number): RefundDecision
```
- Body is the refund object `{ id, status, amount: { currency_code, value } }`. `value` is a PayPal money string; convert with `fromPayPalValue` (unparseable → `paypalCents: undefined` and `mismatch`).
- 2xx: `id` and `status` must be strings, else `keep`. `COMPLETED` → `completed` or `mismatch` as above. `PENDING` → `pending`. `CANCELLED` or `FAILED` → `rejected`. Any other status → `keep`.
- HTTP 400 → `rejected`. HTTP 422 whose `details[].issue` includes an entry of `REFUND_REJECT_ISSUES` → `rejected`. Every other non-2xx (401, 404, 408, 409 "previous call in progress", 422 unknown issue, 429, 5xx) and `network_error` → `keep`. (Unknown errors are never treated as "no refund happened".)

### `planRefundReconcile`
```ts
export type RefundPlanInput = {
  state: "refunding" | "refund_pending";
  paypalRefundId: string | null;   // known once PayPal answered
  claimHash: string;               // refunds.claim_snapshot_hash
  expectedCents: number;
  mode: "read" | "act";            // act may re-POST the refund
};
export type RefundPlan = { do: "none" } | { do: "decide"; decision: RefundDecision } | { do: "repost" };
export function planRefundReconcile(i: RefundPlanInput, read: { status: number; ok: boolean; json: any }): RefundPlan
```
- `refund_pending` with an id: `read` is `GET /v2/payments/refunds/{id}`. Not ok → `none`. Else `decide` with `decideRefundOutcome` on a synthetic 200 response of that body.
- `refunding`: `read` is `GET /v2/checkout/orders/{id}`. Not ok → `none`. Look in `purchase_units[0].payments.refunds[]` for the entry whose `custom_id === claimHash`. Found → `decide` (as a synthetic 200). Not found → `repost` in `act` mode, `none` in `read` mode.

## Runtime
### `src/store/refunds.ts` (self-contained: uses `./db`, `./redemptions`, `../paypal/client`, `../paypal/money`; must not import `./orders`)
- `claimRefund(orderId, who)` where `who = { sid, ip, github?: {id, login}, sample?: SampleName, activeRuleId?: string }` → `{status, body}`:
  1. Order must belong to `sid` (else 404), be `captured` with `buyer_key` null and a capture id and `captured_cents` (else 409 with a reason). Identity: GitHub (live facts via `fetchGithubFacts`, `databaseId` must equal `github.id`, live fetches rate limited as in `quote.ts`) or sample (`sample:<name>:<sid>`); none → 400 "sign in or choose a sample profile". Buyer key `github:<id>` | `sample:<name>:<sid>`.
  2. Rule: the order's `rule_id` row if set, else `activeRuleId`, else `DEFAULT_RULE`. `earnedNow = price(...).earnedCents` for `list_cents`. `R = refundDue(captured_cents, earnedNow)`. `R = 0` → 200 `{state:"captured", refund: null, message:"no refund due"}` and nothing is written.
  3. Transaction: `update orders set state='refunding', buyer_key=$k where id=$1 and state='captured' and buyer_key is null`; claim the redemption (`claimRedemption`; refused → roll back, 409 "this account has already redeemed its discount"); insert the `refunds` row (`state='pending'`, claim snapshot json and hash, `captured_at_claim_cents`, `claim_earned_cents`, `amount_cents=R`).
  4. `POST /v2/payments/captures/{captureId}/refund`, `requestId = hex32(refund id)`, `representation: true`, body `{ amount: { currency_code: "USD", value }, custom_id: "<claimHash>:<refundId>" }` (unique per attempt, so a retry never matches an earlier failed refund).
  5. Apply `decideRefundOutcome` with compare-and-set writes, each in one transaction that also settles the redemption:
     - `completed`: refund `completed` (+`paypal_refund_id`, `paypal_amount_cents`), order `refunded_partial`, `refunded_cents = paypalCents`, redemption `redeemed`.
     - `mismatch`: refund `completed`, order `mismatch`, redemption `redeemed`.
     - `pending`: refund `pending_paypal` (+id), order `refund_pending`, redemption stays `pending`.
     - `rejected`: refund `failed`, order back to `captured` with `buyer_key = null`, redemption deleted (buyer may retry).
     - `keep`: nothing changes; the response says the refund is processing.
- `reconcileRefund(orderId, mode)` runs `planRefundReconcile` with the right GET (`/v2/payments/refunds/{id}` for `refund_pending`, `/v2/checkout/orders/{paypal_order_id}` for `refunding`) and applies the plan; `repost` re-sends the identical POST with the same request id. Never throws; PayPal unreachable leaves the row alone.
- `src/store/orders.ts`: `reconcileOrder` also handles `refunding` and `refund_pending` (delegating to `reconcileRefund`), and `listForSession` reconciles them too.
- `orders` `getOrderForSession` additionally returns `buyerKey`, `paypalCaptureId` is not needed. The receipt shows the licence for `captured`, `refunding`, `refund_pending`, `refunded_partial` (not for `mismatch`).

## Routes
- `POST /api/orders/{id}/claim` (Origin-checked via `guarded`; body `{ sample?: SampleName }`; unknown keys → 400; 20/h per IP) → `claimRefund`. A valid `sample` is stored in the session (`session.sample`) like the quote route does.

## UI (receipt page `/receipt/[id]`)
- For a `captured` order with no buyer: a "Prove your facts for a refund" panel: "Sign in with GitHub" (existing OAuth route with `returnTo` = this order) and the sample profiles; once an identity exists, a "Claim refund" button posting to the claim route, then refresh.
- For `refunding`, `refund_pending`, `refunded_partial`: a "Refund" section reading the refund from PayPal (`payments.refunds[]`): id, status, amount "as recorded by PayPal", refund `custom_id` with "claim hash verified" or a red MISMATCH when it differs from `refunds.claim_snapshot_hash`. If PayPal cannot be read: "PayPal unavailable, retry". No DB money figure is shown as PayPal's.

## Acceptance
- Unit: `refundDue`, `decideRefundOutcome`, `planRefundReconcile` as specified above.
- Integration (real DB, mocked PayPal): claim → completed ⇒ `refunded_partial`, `refunded_cents`, redemption `redeemed`; second claim on the same order ⇒ 409; second order of an already redeemed buyer ⇒ 409 with no PayPal call; `keep` leaves `refunding` and a reconcile (act) re-POSTs with the same request id; `rejected` returns the order to `captured` and frees the buyer; refund never exceeds `captured − earnedNow` (DB check).
- L4 (live sandbox, user approves as buyer): buy at full price as guest, claim with a sample, read the refund back from PayPal; row in `docs/EVIDENCE.md`.
