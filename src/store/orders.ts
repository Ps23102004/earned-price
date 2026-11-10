// Order state machine (docs/ARCHITECTURE.md section 3.5, B1 subset). Every state change is a compare-and-set
// UPDATE ... WHERE state = <expected>; no row lock is held across a PayPal call. PayPal calls time out at 10 s.

import { randomUUID } from "node:crypto";
import { canonicalJson, snapshotHash } from "../facts/snapshot";
import type { GuestSnapshot } from "../facts/types";
import { licenceKey } from "../licence";
import { paypal } from "../paypal/client";
import { toPayPalValue } from "../paypal/money";
import { decideCaptureOutcome } from "./capture-outcome";
import type { CaptureInput, Decision } from "./capture-outcome";
import { query, tx } from "./db";

type Result = { status: number; body: unknown };

export type Order = {
  id: string;
  state: string;
  session_id: string;
  snapshot_json: string;
  snapshot_hash: string;
  list_cents: number;
  earned_cents: number;
  discount_cents: number;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  capture_status: string | null;
  capture_reason: string | null;
  captured_cents: number | null;
  paypal_fee_cents: number | null;
  capture_attempt: number;
  licence_key: string | null;
  created_at: Date;
  // age/expiry flags computed by the database clock
  capture_stale: boolean;
  older_60m: boolean;
  older_6h: boolean;
  quote_expired: boolean;
};

const LIST_CENTS = 4900;
const ITEM_NAME = "Earned Price demo licence";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex = (id: string) => id.replaceAll("-", "");
const money = (cents: number) => ({ currency_code: "USD", value: toPayPalValue(cents) });

const SELECT = `select *,
  (capture_started_at is null or now() - capture_started_at > interval '30 seconds') as capture_stale,
  now() - created_at > interval '60 minutes' as older_60m,
  now() - created_at > interval '6 hours' as older_6h,
  expires_at <= now() as quote_expired
  from orders`;

export async function getOrder(id: string): Promise<Order | undefined> {
  if (!UUID.test(id)) return undefined;
  return (await query<Order>(`${SELECT} where id = $1`, [id])).rows[0];
}

/** The order as the receipt page needs it; undefined for unknown ids and for other sessions' orders. */
export async function getOrderForSession(id: string, sid: string) {
  const o = await getOrder(id);
  if (!o || o.session_id !== sid) return undefined;
  return { id: o.id, state: o.state, paypalOrderId: o.paypal_order_id, snapshotJson: o.snapshot_json, licenceKey: o.licence_key };
}

async function byPayPalId(paypalOrderId: string): Promise<Order | undefined> {
  return (await query<Order>(`${SELECT} where paypal_order_id = $1`, [paypalOrderId])).rows[0];
}

/** Compare-and-set a bare state change; true if this call made it. */
async function setState(id: string, from: string[], to: string): Promise<boolean> {
  const r = await query(`update orders set state = $3, updated_at = now() where id = $1 and state = any($2::text[])`, [id, from, to]);
  return r.rowCount === 1;
}

/** Compare-and-set the outcome of a capture decision, storing whatever PayPal told us about the capture. */
async function applyDecision(id: string, from: string[], d: Decision): Promise<boolean> {
  const c = d.capture;
  const r = await query(
    `update orders set state = $3,
       paypal_capture_id = coalesce($4, paypal_capture_id), capture_status = coalesce($5, capture_status),
       capture_reason = coalesce($6, capture_reason), captured_cents = coalesce($7, captured_cents),
       paypal_fee_cents = coalesce($8, paypal_fee_cents), licence_key = coalesce($9, licence_key), updated_at = now()
     where id = $1 and state = any($2::text[])`,
    [id, from, d.nextState, c?.id ?? null, c?.status ?? null, c?.reason ?? null, c?.amountCents ?? null, c?.feeCents ?? null, d.issueLicence && c ? licenceKey(c.id) : null],
  );
  return r.rowCount === 1;
}

export async function createGuestQuote(sid: string): Promise<Result> {
  const orderId = randomUUID();
  const snapshot: GuestSnapshot = { version: 1, kind: "guest", fetchedAt: new Date().toISOString() };
  await query(
    `insert into orders (id, state, session_id, snapshot_json, snapshot_hash, list_cents, earned_cents, discount_cents, expires_at)
     values ($1, 'quoted', $2, $3, $4, $5, $5, 0, now() + interval '15 minutes')`,
    [orderId, sid, canonicalJson(snapshot), snapshotHash(snapshot), LIST_CENTS],
  );
  return { status: 200, body: { orderId, listCents: LIST_CENTS, earnedCents: LIST_CENTS, discountCents: 0, lines: [] } };
}

export async function createPayPalOrder(orderId: string, sid: string): Promise<Result> {
  const o = await getOrder(orderId);
  if (!o) return { status: 404, body: { error: "order not found" } };
  if (o.session_id !== sid) return { status: 409, body: { error: "order belongs to another session" } };
  if (o.state === "created" && o.paypal_order_id) return { status: 200, body: { paypalOrderId: o.paypal_order_id } }; // retry-safe
  if (o.state !== "quoted") return { status: 409, body: { error: `order is ${o.state}`, state: o.state } };
  if (o.quote_expired) {
    await setState(o.id, ["quoted"], "expired");
    return { status: 409, body: { error: "quote expired", state: "expired" } };
  }
  if (o.earned_cents < 1) return { status: 422, body: { error: "nothing to charge" } };

  const amount: Record<string, unknown> = {
    ...money(o.earned_cents),
    breakdown: { item_total: money(o.list_cents), ...(o.discount_cents > 0 ? { discount: money(o.discount_cents) } : {}) },
  };
  let r;
  try {
    r = await paypal("POST", "/v2/checkout/orders", {
      requestId: `o-${hex(o.id)}`,
      representation: true,
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            invoice_id: o.id,
            custom_id: `${o.id}:${o.snapshot_hash}`,
            items: [{ name: ITEM_NAME, quantity: "1", unit_amount: money(o.list_cents) }],
            amount,
          },
        ],
      },
    });
  } catch (err) {
    console.error("paypal create failed:", err instanceof Error ? err.message : err);
    return { status: 502, body: { error: "PayPal is unavailable, retry" } };
  }
  const paypalOrderId = r.json?.id;
  if (!r.ok || typeof paypalOrderId !== "string") {
    return { status: 502, body: { error: "PayPal could not create the order", debugId: r.debugId } };
  }
  const u = await query(`update orders set state = 'created', paypal_order_id = $2, updated_at = now() where id = $1 and state = 'quoted'`, [o.id, paypalOrderId]);
  if (u.rowCount === 0) {
    const again = await getOrder(o.id); // lost a race with an identical create; PayPal returned the same order
    if (again?.paypal_order_id) return { status: 200, body: { paypalOrderId: again.paypal_order_id } };
    return { status: 409, body: { error: `order is ${again?.state}`, state: again?.state } };
  }
  return { status: 200, body: { paypalOrderId } };
}

/** POST the capture for an order already moved to `capturing` (attempt number is part of the idempotency key). */
async function runCapture(o: Pick<Order, "id" | "paypal_order_id" | "capture_attempt" | "earned_cents">): Promise<Decision> {
  let input: CaptureInput;
  try {
    const r = await paypal("POST", `/v2/checkout/orders/${o.paypal_order_id}/capture`, {
      requestId: `c-${hex(o.id)}-${o.capture_attempt}`,
      representation: true,
    });
    input = { kind: "response", httpStatus: r.status, body: r.json };
  } catch (err) {
    console.error("paypal capture call failed:", err instanceof Error ? err.message : err);
    input = { kind: "network_error" };
  }
  const d = decideCaptureOutcome(input, o.earned_cents);
  await applyDecision(o.id, ["capturing"], d); // 0 rows = reconcile got there first; the row is re-read by the caller
  return d;
}

export async function capture(paypalOrderId: string, sid: string): Promise<Result> {
  // Tx A: created -> approved -> capturing, only for this session's order and only within 60 minutes.
  const claimed = await tx(async (c) => {
    await c.query(`update orders set state = 'approved', updated_at = now() where paypal_order_id = $1 and session_id = $2 and state = 'created'`, [paypalOrderId, sid]);
    const r = await c.query<Pick<Order, "id" | "paypal_order_id" | "capture_attempt" | "earned_cents">>(
      `update orders set state = 'capturing', capture_started_at = now(), capture_attempt = capture_attempt + 1, updated_at = now()
       where paypal_order_id = $1 and session_id = $2 and state = 'approved' and created_at > now() - interval '60 minutes'
       returning id, paypal_order_id, capture_attempt, earned_cents`,
      [paypalOrderId, sid],
    );
    return r.rows[0];
  });

  if (!claimed) {
    const o = await byPayPalId(paypalOrderId);
    if (!o || o.session_id !== sid) return { status: 404, body: { error: "order not found" } };
    if (o.state === "capturing") {
      const now = o.capture_stale ? await reconcileOrder(o.id) : o;
      return { status: 200, body: { state: now?.state, orderId: o.id } };
    }
    if (o.state === "captured") return { status: 200, body: { state: "captured", orderId: o.id } };
    if (o.state === "approved" && o.older_60m) {
      await setState(o.id, ["approved"], "expired");
      return { status: 409, body: { state: "expired", orderId: o.id, error: "order expired", message: "This order expired. You were not charged." } };
    }
    return { status: 409, body: { state: o.state, orderId: o.id, error: `order is ${o.state}` } };
  }

  const decision = await runCapture(claimed);
  const now = await getOrder(claimed.id);
  return {
    status: 200,
    body: {
      state: now?.state,
      orderId: claimed.id,
      ...(decision.clientAction === "restart" && now?.state === "approved" ? { restart: true } : {}),
      message: decision.message,
    },
  };
}

export async function cancel(orderId: string, sid: string): Promise<Result> {
  const u = UUID.test(orderId)
    ? await query(`update orders set state = 'cancelled', updated_at = now() where id = $1 and session_id = $2 and state in ('quoted', 'created', 'approved')`, [orderId, sid])
    : undefined;
  if (u?.rowCount === 1) return { status: 200, body: { state: "cancelled" } };
  const o = await getOrder(orderId);
  if (!o || o.session_id !== sid) return { status: 404, body: { error: "order not found" } };
  if (o.state === "cancelled") return { status: 200, body: { state: "cancelled" } };
  return { status: 409, body: { error: `order is ${o.state}`, state: o.state } };
}

const OPEN = ["created", "approved", "capturing"];

export async function listForSession(sid: string): Promise<Result> {
  // Quotes that never reached PayPal have no receipt, so they are not listed.
  const recent = `select id, state, earned_cents, created_at from orders where session_id = $1 and state <> 'quoted' order by created_at desc limit 10`;
  const open = (await query<{ id: string; state: string }>(recent, [sid])).rows.filter((r) => OPEN.includes(r.state));
  await Promise.all(open.map((r) => reconcileOrder(r.id)));
  const rows = (await query<{ id: string; state: string; earned_cents: number; created_at: Date }>(recent, [sid])).rows;
  return { status: 200, body: rows.map((r) => ({ orderId: r.id, state: r.state, earnedCents: r.earned_cents, createdAt: r.created_at.toISOString() })) };
}

/** Align an open order with what PayPal says. PayPal being unreachable leaves the order as it is. Returns the fresh row. */
export async function reconcileOrder(orderId: string): Promise<Order | undefined> {
  const o = await getOrder(orderId);
  if (!o?.paypal_order_id) return o;
  try {
    if (o.state === "created" || o.state === "approved") await reconcileUncaptured(o);
    else if (o.state === "capturing") await reconcileCapturing(o);
  } catch (err) {
    console.error("reconcile failed:", err instanceof Error ? err.message : err);
  }
  return getOrder(orderId);
}

async function reconcileUncaptured(o: Order): Promise<void> {
  const r = await paypal("GET", `/v2/checkout/orders/${o.paypal_order_id}`);
  if (r.status === 404) return void (await setState(o.id, [o.state], "cancelled"));
  if (!r.ok) return;
  switch (r.json?.status) {
    case "COMPLETED":
      await applyDecision(o.id, [o.state], decideCaptureOutcome({ kind: "response", httpStatus: 200, body: r.json }, o.earned_cents));
      break;
    case "VOIDED":
      await setState(o.id, [o.state], "cancelled");
      break;
    case "CREATED":
      if (o.older_6h) await setState(o.id, [o.state], "expired");
      break;
    // APPROVED: nothing to change; the client re-calls capture to finish the payment.
  }
}

async function reconcileCapturing(o: Order): Promise<void> {
  if (o.paypal_capture_id) {
    const r = await paypal("GET", `/v2/payments/captures/${o.paypal_capture_id}`);
    if (!r.ok) return;
    const body = { purchase_units: [{ payments: { captures: [r.json] } }] };
    await applyDecision(o.id, ["capturing"], decideCaptureOutcome({ kind: "response", httpStatus: 200, body }, o.earned_cents));
    return;
  }
  const r = await paypal("GET", `/v2/checkout/orders/${o.paypal_order_id}`);
  if (r.status === 404) return void (await setState(o.id, ["capturing"], "failed"));
  if (!r.ok) return;
  switch (r.json?.status) {
    case "COMPLETED":
      await applyDecision(o.id, ["capturing"], decideCaptureOutcome({ kind: "response", httpStatus: 200, body: r.json }, o.earned_cents));
      break;
    case "APPROVED": {
      if (!o.capture_stale) return; // the first capture call may still be in flight
      const next = await query<{ capture_attempt: number }>(
        `update orders set capture_attempt = capture_attempt + 1, capture_started_at = now(), updated_at = now()
         where id = $1 and state = 'capturing' and capture_attempt = $2 returning capture_attempt`,
        [o.id, o.capture_attempt],
      );
      if (next.rows[0]) await runCapture({ ...o, capture_attempt: next.rows[0].capture_attempt });
      break;
    }
    case "CREATED":
      await setState(o.id, ["capturing"], "created");
      break;
    case "VOIDED":
      await setState(o.id, ["capturing"], "failed");
      break;
  }
}
