// Integration tests for one-redemption-per-buyer: real Postgres (DATABASE_URL from .env), mocked PayPal.
// Skipped when no database is configured (e.g. a bare CI run).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ paypal: vi.fn() }));
vi.mock("../src/paypal/client", () => ({ paypal: mocks.paypal, assertSandbox: () => {}, SANDBOX_HOST: "https://api-m.sandbox.paypal.com" }));

try {
  process.loadEnvFile(".env");
} catch {
  /* no .env: DATABASE_URL may still be set in the environment */
}
const HAVE_DB = Boolean(process.env.DATABASE_URL);
process.env.LICENSE_HMAC_SECRET ||= "test-secret-test-secret-test-secret-1234";

const EARNED = 2450;
const orderIds: string[] = [];

type Mod = {
  orders: typeof import("../src/store/orders");
  db: typeof import("../src/store/db");
  judge: typeof import("../src/store/judge");
  custom: typeof import("../src/store/custom-id");
};
let m: Mod;

async function insertOrder(o: { buyerKey: string | null; sid: string; state: "quoted" | "created"; discount?: number }) {
  const id = randomUUID();
  const paypalOrderId = `PP-${id.slice(0, 8)}`;
  const earned = o.discount === 0 ? 4900 : EARNED;
  await m.db.query(
    `insert into orders (id, state, session_id, buyer_key, snapshot_json, snapshot_hash, list_cents, earned_cents, discount_cents, paypal_order_id, expires_at)
     values ($1, $2, $3, $4, '{"v":1}', 'hash-${id.slice(0, 6)}', 4900, $5, $6, $7, now() + interval '15 minutes')`,
    [id, o.state, o.sid, o.buyerKey, earned, 4900 - earned, o.state === "created" ? paypalOrderId : null],
  );
  orderIds.push(id);
  return { id, paypalOrderId, hash: `hash-${id.slice(0, 6)}` };
}

const captureBody = (id: string, hash: string, over: { status?: string; value?: string } = {}) => ({
  status: 201,
  ok: true,
  json: {
    purchase_units: [
      {
        payments: {
          captures: [
            {
              id: `CAP-${id.slice(0, 8)}`,
              status: over.status ?? "COMPLETED",
              amount: { value: over.value ?? "24.50", currency_code: "USD" },
              custom_id: `${id}:${hash}`,
              seller_receivable_breakdown: { paypal_fee: { value: "1.12" } },
            },
          ],
        },
      },
    ],
  },
});

const redemption = async (key: string) =>
  (await m.db.query<{ order_id: string; state: string }>(`select order_id, state from redemptions where buyer_key = $1`, [key])).rows[0];
const stateOf = async (id: string) => (await m.orders.getOrder(id))?.state;

describe.skipIf(!HAVE_DB)("one redemption per buyer (real database, mocked PayPal)", () => {
  beforeAll(async () => {
    m = {
      orders: await import("../src/store/orders"),
      db: await import("../src/store/db"),
      judge: await import("../src/store/judge"),
      custom: await import("../src/store/custom-id"),
    };
  });
  beforeEach(() => {
    mocks.paypal.mockReset(); // block body: a function returned from beforeEach would be run as cleanup
  });
  afterAll(async () => {
    if (!m || orderIds.length === 0) return;
    await m.db.query(`delete from redemptions where order_id = any($1::uuid[])`, [orderIds]);
    await m.db.query(`delete from orders where id = any($1::uuid[])`, [orderIds]);
  });

  it("a captured order redeems; a second order for the same buyer is refused before PayPal", async () => {
    const key = `github:${randomUUID()}`;
    const sid = randomUUID();
    const a = await insertOrder({ buyerKey: key, sid, state: "created" });
    mocks.paypal.mockResolvedValueOnce(captureBody(a.id, a.hash));
    const r = await m.orders.capture(a.paypalOrderId, sid);
    expect((r.body as { state: string }).state).toBe("captured");
    expect(await redemption(key)).toMatchObject({ order_id: a.id, state: "redeemed" });
    expect((await m.orders.getOrder(a.id))?.licence_key).toMatch(/^EP-/);

    const b = await insertOrder({ buyerKey: key, sid, state: "quoted" });
    mocks.paypal.mockClear();
    const c = await m.orders.createPayPalOrder(b.id, sid);
    expect(c.status).toBe(409);
    expect((c.body as { error: string }).error).toBe("already redeemed");
    expect(mocks.paypal).not.toHaveBeenCalled(); // refused before touching PayPal
    expect(await stateOf(b.id)).toBe("cancelled");
  });

  it("two approved orders for one buyer racing to capture: exactly one reaches PayPal", async () => {
    const key = `github:${randomUUID()}`;
    const sid = randomUUID();
    const a = await insertOrder({ buyerKey: key, sid, state: "created" });
    const b = await insertOrder({ buyerKey: key, sid, state: "created" });
    mocks.paypal.mockImplementation(async (_m: string, path: string) => {
      const o = path.includes(a.paypalOrderId) ? a : b;
      return captureBody(o.id, o.hash);
    });
    const [ra, rb] = await Promise.all([m.orders.capture(a.paypalOrderId, sid), m.orders.capture(b.paypalOrderId, sid)]);
    const states = [(ra.body as { state: string }).state, (rb.body as { state: string }).state].sort();
    expect(states).toEqual(["cancelled", "captured"]);
    const captures = mocks.paypal.mock.calls.filter((c) => String(c[1]).endsWith("/capture"));
    expect(captures).toHaveLength(1);
    expect((await redemption(key))?.state).toBe("redeemed");
  });

  it("a timeout keeps the redemption pending, so the buyer cannot redeem a second time", async () => {
    const key = `github:${randomUUID()}`;
    const sid = randomUUID();
    const a = await insertOrder({ buyerKey: key, sid, state: "created" });
    mocks.paypal.mockRejectedValueOnce(new Error("timeout"));
    const r = await m.orders.capture(a.paypalOrderId, sid);
    expect((r.body as { state: string }).state).toBe("capturing");
    expect(await redemption(key)).toMatchObject({ order_id: a.id, state: "pending" });

    // PayPal still says APPROVED (the first attempt may be in flight): nothing is released.
    mocks.paypal.mockResolvedValue({ status: 200, ok: true, json: { status: "APPROVED" } });
    const b = await insertOrder({ buyerKey: key, sid, state: "quoted" });
    const c = await m.orders.createPayPalOrder(b.id, sid);
    expect(c.status).toBe(409);
    expect((await redemption(key))?.order_id).toBe(a.id);
    expect(await stateOf(a.id)).toBe("capturing");
  });

  it("a PayPal-confirmed DECLINED capture releases the redemption", async () => {
    const key = `github:${randomUUID()}`;
    const sid = randomUUID();
    const a = await insertOrder({ buyerKey: key, sid, state: "created" });
    mocks.paypal.mockResolvedValueOnce(captureBody(a.id, a.hash, { status: "DECLINED" }));
    const r = await m.orders.capture(a.paypalOrderId, sid);
    expect((r.body as { state: string }).state).toBe("failed");
    expect(await redemption(key)).toBeUndefined();
    expect((await m.orders.getOrder(a.id))?.licence_key).toBeNull();
  });

  it("INSTRUMENT_DECLINED releases the redemption and keeps the order approvable", async () => {
    const key = `github:${randomUUID()}`;
    const sid = randomUUID();
    const a = await insertOrder({ buyerKey: key, sid, state: "created" });
    mocks.paypal.mockResolvedValueOnce({ status: 422, ok: false, json: { details: [{ issue: "INSTRUMENT_DECLINED" }] } });
    const r = await m.orders.capture(a.paypalOrderId, sid);
    expect(r.body).toMatchObject({ state: "approved", restart: true });
    expect(await redemption(key)).toBeUndefined();
  });

  it("an amount mismatch keeps the redemption (money moved) and issues no licence", async () => {
    const key = `github:${randomUUID()}`;
    const sid = randomUUID();
    const a = await insertOrder({ buyerKey: key, sid, state: "created" });
    mocks.paypal.mockResolvedValueOnce(captureBody(a.id, a.hash, { value: "49.00" }));
    const r = await m.orders.capture(a.paypalOrderId, sid);
    expect((r.body as { state: string }).state).toBe("mismatch");
    expect(await redemption(key)).toMatchObject({ state: "redeemed" });
    expect((await m.orders.getOrder(a.id))?.licence_key).toBeNull();
  });

  it("a guest order (no buyer key) never touches redemptions", async () => {
    const sid = randomUUID();
    const a = await insertOrder({ buyerKey: null, sid, state: "created", discount: 0 });
    mocks.paypal.mockResolvedValueOnce(captureBody(a.id, a.hash, { value: "49.00" }));
    const r = await m.orders.capture(a.paypalOrderId, sid);
    expect((r.body as { state: string }).state).toBe("captured");
    const n = (await m.db.query<{ n: string }>(`select count(*) n from redemptions where order_id = $1`, [a.id])).rows[0]!.n;
    expect(Number(n)).toBe(0);
  });

  it("cancelling before capture claims nothing; a cancelled order does not block the buyer", async () => {
    const key = `github:${randomUUID()}`;
    const sid = randomUUID();
    const a = await insertOrder({ buyerKey: key, sid, state: "created" });
    expect((await m.orders.cancel(a.id, sid)).status).toBe(200);
    expect(await redemption(key)).toBeUndefined();
  });

  it("reset releases a redeemed buyer; it refuses while a payment is in progress", async () => {
    const key = `github:${randomUUID()}`;
    const sid = randomUUID();
    const a = await insertOrder({ buyerKey: key, sid, state: "created" });
    mocks.paypal.mockResolvedValueOnce(captureBody(a.id, a.hash));
    await m.orders.capture(a.paypalOrderId, sid);
    expect(await m.judge.resetRedemptions([key])).toMatchObject({ status: 200, body: { released: 1, blocked: 0 } });
    expect(await redemption(key)).toBeUndefined();
    expect(await m.judge.resetRedemptions([key])).toMatchObject({ status: 200, body: { released: 0 } });
    expect(await stateOf(a.id)).toBe("captured"); // orders are never touched by a reset

    const key2 = `github:${randomUUID()}`;
    const p = await insertOrder({ buyerKey: key2, sid, state: "created" });
    mocks.paypal.mockRejectedValueOnce(new Error("timeout"));
    await m.orders.capture(p.paypalOrderId, sid); // now `capturing`
    mocks.paypal.mockResolvedValue({ status: 200, ok: true, json: { status: "APPROVED" } });
    const r = await m.judge.resetRedemptions([key2]);
    expect(r.status).toBe(409);
    expect((await redemption(key2))?.state).toBe("pending");
  });
});
