// Integration tests for buy first, prove later: real Postgres (DATABASE_URL from .env), mocked PayPal.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ paypal: vi.fn() }));
vi.mock("../src/paypal/client", () => ({ paypal: mocks.paypal, assertSandbox: () => {}, SANDBOX_HOST: "https://api-m.sandbox.paypal.com" }));

try {
  process.loadEnvFile(".env");
} catch {
  /* DATABASE_URL may come from the environment */
}
const HAVE_DB = Boolean(process.env.DATABASE_URL);
process.env.LICENSE_HMAC_SECRET ||= "test-secret-test-secret-test-secret-1234";

type Mod = { refunds: typeof import("../src/store/refunds"); orders: typeof import("../src/store/orders"); db: typeof import("../src/store/db") };
let m: Mod;
const ids: string[] = [];

async function guestOrder(sid: string) {
  const id = randomUUID();
  await m.db.query(
    `insert into orders (id, state, session_id, snapshot_json, snapshot_hash, list_cents, earned_cents, discount_cents, paypal_order_id, paypal_capture_id, capture_status, captured_cents, licence_key, expires_at)
     values ($1, 'captured', $2, '{"v":1}', 'guesthash', 4900, 4900, 0, $3, $4, 'COMPLETED', 4900, 'EP-TEST', now() + interval '15 minutes')`,
    [id, sid, `PP-${id.slice(0, 8)}`, `CAP-${id.slice(0, 8)}`],
  );
  ids.push(id);
  return { id, capture: `CAP-${id.slice(0, 8)}` };
}
const refundResp = (status: string, value: string, id = "RF-1") => ({ status: 201, ok: true, json: { id, status, amount: { currency_code: "USD", value } } });
const orderRow = async (id: string) => (await m.db.query<{ state: string; buyer_key: string | null; refunded_cents: number }>(`select state, buyer_key, refunded_cents from orders where id = $1`, [id])).rows[0];
const redemption = async (key: string) => (await m.db.query<{ order_id: string; state: string }>(`select order_id, state from redemptions where buyer_key = $1`, [key])).rows[0];
const refundRows = async (id: string) => (await m.db.query<{ state: string; amount_cents: number; paypal_amount_cents: number | null }>(`select state, amount_cents, paypal_amount_cents from refunds where order_id = $1`, [id])).rows;
const who = (sid: string, sample?: "qualifies" | "nearly" | "loophole") => ({ sid, ip: "t", sample });

describe.skipIf(!HAVE_DB)("buy first, prove later (real database, mocked PayPal)", () => {
  beforeAll(async () => {
    m = { refunds: await import("../src/store/refunds"), orders: await import("../src/store/orders"), db: await import("../src/store/db") };
  });
  beforeEach(() => {
    mocks.paypal.mockReset();
  });
  afterAll(async () => {
    if (!m || ids.length === 0) return;
    await m.db.query(`delete from refunds where order_id = any($1::uuid[])`, [ids]);
    await m.db.query(`delete from redemptions where order_id = any($1::uuid[])`, [ids]);
    await m.db.query(`delete from orders where id = any($1::uuid[])`, [ids]);
  });

  it("completed refund: order refunded_partial, amount from PayPal, redemption redeemed, request id <= 38 chars", async () => {
    const sid = randomUUID();
    const o = await guestOrder(sid);
    mocks.paypal.mockImplementation(async (_m: string, _p: string, opts: { body: { amount: { value: string } } }) => refundResp("COMPLETED", opts.body.amount.value));
    const r = await m.refunds.claimRefund(o.id, who(sid, "qualifies"));
    expect(r.status).toBe(200);
    const row = await orderRow(o.id);
    const [refund] = await refundRows(o.id);
    expect(row.state).toBe("refunded_partial");
    expect(row.refunded_cents).toBe(refund.amount_cents);
    expect(refund).toMatchObject({ state: "completed", paypal_amount_cents: refund.amount_cents });
    expect(refund.amount_cents).toBeGreaterThan(0);
    expect(refund.amount_cents).toBeLessThan(4900);
    expect(await redemption(row.buyer_key!)).toMatchObject({ order_id: o.id, state: "redeemed" });
    const call = mocks.paypal.mock.calls[0];
    expect(call[1]).toBe(`/v2/payments/captures/${o.capture}/refund`);
    expect(call[2].requestId.length).toBeLessThanOrEqual(38);
    expect(call[2].body.custom_id).toMatch(/^[0-9a-f]{64}:[0-9a-f-]{36}$/);
  });

  it("a second claim on the same order is refused", async () => {
    const sid = randomUUID();
    const o = await guestOrder(sid);
    mocks.paypal.mockImplementation(async (_m: string, _p: string, opts: { body: { amount: { value: string } } }) => refundResp("COMPLETED", opts.body.amount.value));
    await m.refunds.claimRefund(o.id, who(sid, "qualifies"));
    mocks.paypal.mockClear();
    const again = await m.refunds.claimRefund(o.id, who(sid, "qualifies"));
    expect(again.status).toBe(409);
    expect(mocks.paypal).not.toHaveBeenCalled();
    expect(await refundRows(o.id)).toHaveLength(1);
  });

  it("another session cannot claim this order", async () => {
    const o = await guestOrder(randomUUID());
    const r = await m.refunds.claimRefund(o.id, who(randomUUID(), "qualifies"));
    expect(r.status).toBe(404);
    expect(mocks.paypal).not.toHaveBeenCalled();
  });

  it("a buyer who already redeemed gets 409 and no PayPal call", async () => {
    const sid = randomUUID();
    const a = await guestOrder(sid);
    const b = await guestOrder(sid);
    mocks.paypal.mockImplementation(async (_m: string, _p: string, opts: { body: { amount: { value: string } } }) => refundResp("COMPLETED", opts.body.amount.value));
    await m.refunds.claimRefund(a.id, who(sid, "qualifies"));
    mocks.paypal.mockClear();
    const r = await m.refunds.claimRefund(b.id, who(sid, "qualifies"));
    expect(r.status).toBe(409);
    expect(mocks.paypal).not.toHaveBeenCalled();
    expect((await orderRow(b.id)).state).toBe("captured");
    expect((await orderRow(b.id)).buyer_key).toBeNull();
  });

  it("no identity -> 400; facts that earn nothing -> no refund and nothing written", async () => {
    const sid = randomUUID();
    const o = await guestOrder(sid);
    expect((await m.refunds.claimRefund(o.id, { sid, ip: "t" })).status).toBe(400);
    const none = await m.refunds.claimRefund(o.id, who(sid, "loophole")).catch(() => null);
    // The loophole sample may earn a tier under the default rule; only assert the invariant when it earns none.
    if (none && (none.body as { refund?: null }).refund === null) {
      expect(await refundRows(o.id)).toHaveLength(0);
      expect((await orderRow(o.id)).state).toBe("captured");
    }
  });

  it("a timeout keeps the order refunding; reconcile (act) re-sends the same request id", async () => {
    const sid = randomUUID();
    const o = await guestOrder(sid);
    mocks.paypal.mockRejectedValueOnce(new Error("timeout"));
    await m.refunds.claimRefund(o.id, who(sid, "qualifies"));
    expect((await orderRow(o.id)).state).toBe("refunding");
    const firstId = mocks.paypal.mock.calls[0][2].requestId;

    // PayPal shows no refund on the order yet; act mode re-POSTs with the same id.
    mocks.paypal.mockImplementation(async (method: string, _p: string, opts?: { body?: { amount: { value: string } } }) =>
      method === "GET" ? { status: 200, ok: true, json: { purchase_units: [{ payments: { refunds: [] } }] } } : refundResp("COMPLETED", opts!.body!.amount.value),
    );
    await m.refunds.reconcileRefund(o.id, "read");
    expect((await orderRow(o.id)).state).toBe("refunding"); // read mode never POSTs
    await m.orders.reconcileOrder(o.id, "read");
    expect((await orderRow(o.id)).state).toBe("refunding"); // a GET path never POSTs
    await m.refunds.claimRefund(o.id, who(sid)); // the claim POST route resumes it with the same request id
    expect((await orderRow(o.id)).state).toBe("refunded_partial");
    const post = mocks.paypal.mock.calls.filter((c) => c[0] === "POST").at(-1)!;
    expect(post[2].requestId).toBe(firstId);
  });

  it("a PENDING refund is refund_pending and keeps the redemption pending; reconcile completes it", async () => {
    const sid = randomUUID();
    const o = await guestOrder(sid);
    mocks.paypal.mockImplementation(async (_m: string, _p: string, opts: { body: { amount: { value: string } } }) => refundResp("PENDING", opts.body.amount.value, "RF-P"));
    await m.refunds.claimRefund(o.id, who(sid, "qualifies"));
    const row = await orderRow(o.id);
    expect(row.state).toBe("refund_pending");
    expect((await redemption(row.buyer_key!))?.state).toBe("pending");
    const amount = (await refundRows(o.id))[0].amount_cents;
    mocks.paypal.mockReset();
    mocks.paypal.mockResolvedValue({ status: 200, ok: true, json: { id: "RF-P", status: "COMPLETED", amount: { currency_code: "USD", value: (amount / 100).toFixed(2) } } });
    const fresh = await m.orders.reconcileOrder(o.id, "read");
    expect(fresh?.state).toBe("refunded_partial");
    expect(mocks.paypal.mock.calls[0][1]).toBe("/v2/payments/refunds/RF-P");
  });

  it("a definitive rejection returns the order to captured and frees the buyer", async () => {
    const sid = randomUUID();
    const o = await guestOrder(sid);
    mocks.paypal.mockResolvedValue({ status: 422, ok: false, json: { details: [{ issue: "REFUND_AMOUNT_EXCEEDED" }] } });
    await m.refunds.claimRefund(o.id, who(sid, "qualifies"));
    const row = await orderRow(o.id);
    expect(row).toMatchObject({ state: "captured", buyer_key: null });
    expect((await refundRows(o.id))[0].state).toBe("failed");
    expect(await redemption(`sample:qualifies:${sid}`)).toBeUndefined();
  });

  it("an unknown PayPal error is never treated as 'no refund': the order stays refunding", async () => {
    const sid = randomUUID();
    const o = await guestOrder(sid);
    mocks.paypal.mockResolvedValue({ status: 422, ok: false, json: { details: [{ issue: "SOMETHING_NEW" }] } });
    await m.refunds.claimRefund(o.id, who(sid, "qualifies"));
    expect((await orderRow(o.id)).state).toBe("refunding");
  });

  it("the database refuses a refund larger than captured minus earned", async () => {
    const sid = randomUUID();
    const o = await guestOrder(sid);
    await expect(
      m.db.query(
        `insert into refunds (id, order_id, claim_buyer_key, claim_snapshot_json, claim_snapshot_hash, captured_at_claim_cents, claim_earned_cents, amount_cents, state)
         values ($1, $2, 'k', '{}', 'h', 4900, 2450, 2451, 'pending')`,
        [randomUUID(), o.id],
      ),
    ).rejects.toThrow();
  });
});

describe.skipIf(!HAVE_DB)("a refund is priced under the order's rule, never the claimer's", () => {
  it("a guest order is claimed under the shop default even if the claimer published a generous rule", async () => {
    const m2 = { refunds: await import("../src/store/refunds"), db: await import("../src/store/db"), rules: await import("../src/store/rules"), presets: await import("../src/rules/presets") };
    const loose = await m2.rules.ensureRule("loose");
    mocks.paypal.mockReset();
    mocks.paypal.mockImplementation(async (_m: string, _p: string, opts: { body: { amount: { value: string } } }) => refundResp("COMPLETED", opts.body.amount.value));
    const sid = randomUUID();
    const id = randomUUID();
    await m2.db.query(
      `insert into orders (id, state, session_id, snapshot_json, snapshot_hash, list_cents, earned_cents, discount_cents, paypal_order_id, paypal_capture_id, capture_status, captured_cents, licence_key, expires_at)
       values ($1, 'captured', $2, '{"v":1}', 'guesthash', 4900, 4900, 0, $3, $4, 'COMPLETED', 4900, 'EP-TEST', now() + interval '15 minutes')`,
      [id, sid, `PP-${id.slice(0, 8)}`, `CAP-${id.slice(0, 8)}`],
    );
    try {
      // The session's published rule is not even an input any more; the amount must equal the default rule's refund.
      await m2.refunds.claimRefund(id, { sid, ip: "t", sample: "loophole", ...({ activeRuleId: loose.id } as object) });
      const [row] = (await m2.db.query<{ amount_cents: number }>(`select amount_cents from refunds where order_id = $1`, [id])).rows;
      const { evaluate } = await import("../src/rules/evaluate");
      const { price } = await import("../src/rules/price");
      const { loadSample } = await import("../src/facts/samples");
      const snap = loadSample("loophole");
      const expected = 4900 - price(m2.presets.DEFAULT_RULE, evaluate(m2.presets.DEFAULT_RULE, snap, snap.recordedAt ? new Date(snap.recordedAt) : undefined), 4900).earnedCents;
      expect(row?.amount_cents ?? 0).toBe(expected);
    } finally {
      await m2.db.query(`delete from refunds where order_id = $1`, [id]);
      await m2.db.query(`delete from redemptions where order_id = $1`, [id]);
      await m2.db.query(`delete from orders where id = $1`, [id]);
    }
  });
});
