// Buy first, prove later (docs/specs/B5-buy-first-prove-later.md). A guest paid list price; with proven facts the code
// refunds captured minus what the rules now say. Every transition is compare-and-set, no lock spans a PayPal call, and
// this module does not import ./orders (orders delegates refund reconciliation here).

import { randomUUID } from "node:crypto";
import { fetchGithubFacts } from "../facts/github";
import { loadSample } from "../facts/samples";
import type { SampleName } from "../facts/samples";
import { canonicalJson, snapshotHash } from "../facts/snapshot";
import type { GithubSnapshot } from "../facts/types";
import { paypal } from "../paypal/client";
import { toPayPalValue } from "../paypal/money";
import { allow } from "../ratelimit";
import { evaluate } from "../rules/evaluate";
import { DEFAULT_RULE } from "../rules/presets";
import { price } from "../rules/price";
import { query, tx } from "./db";
import { claimRedemption, settleRedemption } from "./redemptions";
import { decideRefundOutcome, planRefundReconcile, refundDue } from "./refund-outcome";
import type { RefundDecision, RefundInput } from "./refund-outcome";
import { loadRuleRow } from "./rules";

type Result = { status: number; body: unknown };
export type Who = { sid: string; ip: string; github?: { id: number; login: string }; sample?: SampleName };

type Row = {
  id: string;
  state: string;
  session_id: string;
  buyer_key: string | null;
  rule_id: string | null;
  list_cents: number;
  captured_cents: number | null;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
};
type RefundRow = {
  id: string;
  order_id: string;
  claim_snapshot_hash: string;
  amount_cents: number;
  state: string;
  paypal_refund_id: string | null;
  claim_buyer_key: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALREADY = "This account has already redeemed its discount.";
class RedeemedElsewhere extends Error {}
class RaceLost extends Error {}

const ORDER = `select id, state, session_id, buyer_key, rule_id, list_cents, captured_cents, paypal_order_id, paypal_capture_id from orders`;

const requestId = (refundId: string) => refundId.replaceAll("-", ""); // 32 chars, within PayPal's 38
/** Unique per refund attempt: a retry with the same facts must never match an earlier, failed refund on the same capture. */
export const refundCustomId = (claimHash: string, refundId: string) => `${claimHash}:${refundId}`;

export async function claimRefund(orderId: string, who: Who): Promise<Result> {
  if (!UUID.test(orderId)) return { status: 404, body: { error: "order not found" } };
  const o = (await query<Row>(`${ORDER} where id = $1`, [orderId])).rows[0];
  if (!o || o.session_id !== who.sid) return { status: 404, body: { error: "order not found" } };
  if (o.state === "refunding" || o.state === "refund_pending") {
    // Resume: re-sends a stuck refund with its stored request id and amount (PayPal answers with the first call's result).
    await reconcileRefund(o.id, "act");
    const now = (await query<{ state: string }>(`select state from orders where id = $1`, [o.id])).rows[0];
    return { status: 200, body: { state: now?.state, orderId: o.id, message: "Checked with PayPal. The receipt shows the refund as PayPal recorded it." } };
  }
  if (o.state !== "captured" || o.buyer_key || !o.paypal_capture_id || o.captured_cents === null) {
    return { status: 409, body: { error: `order is ${o.state}`, state: o.state, message: o.buyer_key ? "This order was already claimed." : "Only a paid order can be claimed." } };
  }

  // Facts: a sample profile or the signed-in GitHub account.
  // The rule the order was priced under, else the shop's default. Never the claimer's own published rule: a buyer must not be
  // able to write the rule that decides their refund after paying.
  const rule = (o.rule_id ? (await loadRuleRow(o.rule_id))?.rule : undefined) ?? DEFAULT_RULE;
  let snapshot: GithubSnapshot;
  let buyerKey: string;
  if (who.sample) {
    snapshot = loadSample(who.sample);
    buyerKey = `sample:${who.sample}:${who.sid}`;
  } else if (who.github) {
    if (!allow(`live:${who.ip}`, 20, 3_600_000)) return { status: 429, body: { error: "too many live lookups, try again later or use a sample profile" } };
    try {
      const token = process.env.GITHUB_SERVER_TOKEN;
      if (!token) throw new Error("GITHUB_SERVER_TOKEN is not set");
      const facts = await fetchGithubFacts(who.github.login, rule, { token });
      if (facts.databaseId !== who.github.id) return { status: 409, body: { error: "account changed" } };
      snapshot = facts.snapshot;
    } catch (err) {
      console.error("github facts failed:", err instanceof Error ? err.message : err);
      return { status: 502, body: { error: "GitHub is unavailable; try again or use a sample profile" } };
    }
    buyerKey = `github:${who.github.id}`;
  } else {
    return { status: 400, body: { error: "sign in with GitHub or choose a sample profile" } };
  }

  const evaluated = evaluate(rule, snapshot, snapshot.recordedAt ? new Date(snapshot.recordedAt) : undefined);
  const earnedNow = price(rule, evaluated, o.list_cents).earnedCents;
  const due = refundDue(o.captured_cents, earnedNow);
  if (due === 0) return { status: 200, body: { state: "captured", refund: null, message: "No refund is due: these facts do not earn a discount." } };

  const refundId = randomUUID();
  const claimHash = snapshotHash(snapshot);
  try {
    await tx(async (c) => {
      const u = await c.query(`update orders set state = 'refunding', buyer_key = $2, updated_at = now() where id = $1 and state = 'captured' and buyer_key is null`, [o.id, buyerKey]);
      if (u.rowCount !== 1) throw new RaceLost();
      if (!(await claimRedemption(c, buyerKey, o.id))) throw new RedeemedElsewhere();
      await c.query(
        `insert into refunds (id, order_id, claim_buyer_key, claim_snapshot_json, claim_snapshot_hash, captured_at_claim_cents, claim_earned_cents, amount_cents, state)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
        [refundId, o.id, buyerKey, canonicalJson(snapshot), claimHash, o.captured_cents, earnedNow, due],
      );
    });
  } catch (e) {
    if (e instanceof RedeemedElsewhere) return { status: 409, body: { error: "already redeemed", message: `${ALREADY} No refund was issued.` } };
    if (e instanceof RaceLost) return { status: 409, body: { error: "order already claimed" } };
    throw e;
  }

  const input = await postRefund(o.paypal_capture_id, refundId, due, refundCustomId(claimHash, refundId));
  const decision = decideRefundOutcome(input, due);
  await applyDecision(o.id, refundId, decision);
  const now = (await query<{ state: string }>(`select state from orders where id = $1`, [o.id])).rows[0];
  return { status: 200, body: { state: now?.state, orderId: o.id, message: messageFor(decision) } };
}

async function postRefund(captureId: string, refundId: string, cents: number, customId: string): Promise<RefundInput> {
  try {
    const r = await paypal("POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      requestId: requestId(refundId),
      representation: true,
      body: {
        amount: { currency_code: "USD", value: toPayPalValue(cents) },
        custom_id: customId,
        note_to_payer: "Earned Price: you proved public facts after paying, so the difference to the price those facts earn is refunded.",
      },
    });
    return { kind: "response", httpStatus: r.status, body: r.json };
  } catch (err) {
    console.error("paypal refund call failed:", err instanceof Error ? err.message : err);
    return { kind: "network_error" };
  }
}

function messageFor(d: RefundDecision): string {
  switch (d.kind) {
    case "completed":
      return "Refund issued. The receipt shows it as PayPal recorded it.";
    case "mismatch":
      return "PayPal refunded a different amount than requested. See the receipt.";
    case "pending":
      return "The refund is pending at PayPal.";
    case "rejected":
      return d.message;
    default:
      return "The refund is processing at PayPal. The receipt page will confirm it.";
  }
}

/** Compare-and-set the outcome; the order state, refund row and redemption move in one transaction. */
async function applyDecision(orderId: string, refundId: string, d: RefundDecision): Promise<boolean> {
  if (d.kind === "keep") return false;
  return tx(async (c) => {
    switch (d.kind) {
      case "completed":
      case "mismatch": {
        const r = await c.query(
          `update refunds set state = 'completed', paypal_refund_id = $2, paypal_amount_cents = $3, updated_at = now()
           where id = $1 and state in ('pending', 'pending_paypal')`,
          [refundId, d.refundId, d.paypalCents ?? null],
        );
        if (r.rowCount !== 1) return false;
        const ok = d.kind === "completed";
        await c.query(
          `update orders set state = $2, refunded_cents = case when $3::int is not null and $3::int <= captured_cents then $3::int else refunded_cents end, updated_at = now()
           where id = $1 and state in ('refunding', 'refund_pending')`,
          [orderId, ok ? "refunded_partial" : "mismatch", d.paypalCents ?? null],
        );
        await settleRedemption(c, orderId, "redeem");
        return true;
      }
      case "pending": {
        const r = await c.query(`update refunds set state = 'pending_paypal', paypal_refund_id = $2, updated_at = now() where id = $1 and state = 'pending'`, [refundId, d.refundId]);
        if (r.rowCount !== 1) return false;
        await c.query(`update orders set state = 'refund_pending', updated_at = now() where id = $1 and state = 'refunding'`, [orderId]);
        return true; // redemption stays pending
      }
      case "rejected": {
        const r = await c.query(`update refunds set state = 'failed', updated_at = now() where id = $1 and state in ('pending', 'pending_paypal')`, [refundId]);
        if (r.rowCount !== 1) return false;
        await c.query(`update orders set state = 'captured', buyer_key = null, updated_at = now() where id = $1 and state in ('refunding', 'refund_pending')`, [orderId]);
        await settleRedemption(c, orderId, "release");
        return true;
      }
    }
  });
}

/** Align a `refunding` / `refund_pending` order with PayPal. Never throws; PayPal being unreachable changes nothing. */
export async function reconcileRefund(orderId: string, mode: "read" | "act"): Promise<void> {
  try {
    const o = (await query<Row>(`${ORDER} where id = $1`, [orderId])).rows[0];
    if (!o || (o.state !== "refunding" && o.state !== "refund_pending") || !o.paypal_order_id) return;
    const f = (await query<RefundRow>(`select * from refunds where order_id = $1 and state <> 'failed'`, [orderId])).rows[0];
    if (!f) return;
    const read =
      o.state === "refund_pending" && f.paypal_refund_id
        ? await paypal("GET", `/v2/payments/refunds/${encodeURIComponent(f.paypal_refund_id)}`)
        : await paypal("GET", `/v2/checkout/orders/${encodeURIComponent(o.paypal_order_id)}`);
    const plan = planRefundReconcile({ state: o.state, paypalRefundId: f.paypal_refund_id, claimHash: refundCustomId(f.claim_snapshot_hash, f.id), expectedCents: f.amount_cents, mode }, read);
    if (plan.do === "decide") await applyDecision(orderId, f.id, plan.decision);
    else if (plan.do === "repost" && o.paypal_capture_id) {
      // Same request id: PayPal returns the stored result of the first call instead of refunding twice.
      await applyDecision(orderId, f.id, decideRefundOutcome(await postRefund(o.paypal_capture_id, f.id, f.amount_cents, refundCustomId(f.claim_snapshot_hash, f.id)), f.amount_cents));
    }
  } catch (err) {
    console.error("refund reconcile failed:", err instanceof Error ? err.message : err);
  }
}

/** The custom_id ("<claim snapshot hash>:<refund id>") a refund's PayPal record must carry (receipt check). Undefined when there is no live refund. */
export async function expectedRefundCustomId(orderId: string): Promise<string | undefined> {
  const r = (await query<{ id: string; claim_snapshot_hash: string }>(`select id, claim_snapshot_hash from refunds where order_id = $1 and state <> 'failed'`, [orderId])).rows[0];
  return r ? refundCustomId(r.claim_snapshot_hash, r.id) : undefined;
}
