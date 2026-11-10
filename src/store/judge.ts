// Judge-mode reset (docs/ARCHITECTURE.md section 3.5, F8): releases a buyer's redemption so the demo can be repeated.
// Orders and refunds are never touched, so a reset can only enable a new purchase, never a second refund on an old order.
import { query } from "./db";
import { getOrder, reconcileOrder } from "./orders";
import { redemptionFor } from "./redemptions";

type Result = { status: number; body: unknown };
const IN_FLIGHT = ["capturing", "refunding", "refund_pending"];

export async function resetRedemptions(buyerKeys: string[]): Promise<Result> {
  let released = 0;
  let blocked = 0;
  for (const key of buyerKeys) {
    const held = await redemptionFor({ query }, key);
    if (!held) continue;
    await reconcileOrder(held.order_id, "act"); // a stuck order may resolve (and release itself) first
    const order = await getOrder(held.order_id);
    if (order && IN_FLIGHT.includes(order.state)) {
      blocked++;
      continue;
    }
    released += (await query(`delete from redemptions where buyer_key = $1`, [key])).rowCount ?? 0;
  }
  if (blocked > 0 && released === 0) {
    return { status: 409, body: { error: "a payment is still in progress for this account", released, blocked } };
  }
  return { status: 200, body: { released, blocked } };
}
