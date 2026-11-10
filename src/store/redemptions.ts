// One redemption per buyer (docs/ARCHITECTURE.md section 3.5). The `redemptions` primary key is the limit.
// A redemption is claimed in the same transaction that moves an order to `capturing`, settled in the same transaction
// as the state change that follows, and released only when PayPal confirmed that nothing was captured.

// Anything with a pg-style query(): a pooled client inside a transaction, or the pool wrapper.
type Q = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };

export type Effect = "redeem" | "release" | "keep";

/** What a transition INTO `state` does to the order's redemption. Timeouts and unknowns map to `capturing`: keep. */
export function effectOf(state: string, releaseRedemption = false): Effect {
  if (state === "captured" || state === "mismatch") return "redeem";
  if (releaseRedemption) return "release";
  return ["failed", "expired", "cancelled", "created", "approved", "quoted"].includes(state) ? "release" : "keep";
}

/** Claim for this order. False when the buyer's redemption belongs to a different order. */
export async function claimRedemption(q: Q, buyerKey: string, orderId: string): Promise<boolean> {
  const ins = await q.query(
    `insert into redemptions (buyer_key, order_id, state) values ($1, $2, 'pending') on conflict (buyer_key) do nothing returning order_id`,
    [buyerKey, orderId],
  );
  if (ins.rows[0]) return true;
  const cur = await q.query(`select order_id from redemptions where buyer_key = $1`, [buyerKey]);
  return cur.rows[0]?.order_id === orderId;
}

export async function settleRedemption(q: Q, orderId: string, effect: Effect): Promise<void> {
  if (effect === "redeem") await q.query(`update redemptions set state = 'redeemed' where order_id = $1`, [orderId]);
  else if (effect === "release") await q.query(`delete from redemptions where order_id = $1 and state = 'pending'`, [orderId]);
}

export async function redemptionFor(q: Q, buyerKey: string): Promise<{ order_id: string; state: string } | undefined> {
  return (await q.query(`select order_id, state from redemptions where buyer_key = $1`, [buyerKey])).rows[0] as { order_id: string; state: string } | undefined;
}

/** The buyer keys a browser session can have redeemed: its GitHub account and/or its current sample profile. */
export function buyerKeysOf(s: { sid: string; github?: { id: number }; sample?: string }): string[] {
  return [s.github ? `github:${s.github.id}` : "", s.sample ? `sample:${s.sample}:${s.sid}` : ""].filter(Boolean);
}
