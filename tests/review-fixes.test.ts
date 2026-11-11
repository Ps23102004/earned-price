// Regression tests for the independent review of B2-B4: stuck captures, reconcile claiming the redemption, expiry.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decideCaptureOutcome } from "../src/store/capture-outcome";
import { RECAPTURE_LIMIT, planReconcile } from "../src/store/reconcile-plan";
import type { PlanInput } from "../src/store/reconcile-plan";

const mocks = vi.hoisted(() => ({ paypal: vi.fn() }));
vi.mock("../src/paypal/client", () => ({ paypal: mocks.paypal, assertSandbox: () => {}, SANDBOX_HOST: "https://api-m.sandbox.paypal.com" }));

try {
  process.loadEnvFile(".env");
} catch {
  /* DATABASE_URL may come from the environment */
}
const HAVE_DB = Boolean(process.env.DATABASE_URL);
process.env.LICENSE_HMAC_SECRET ||= "test-secret-test-secret-test-secret-1234";

const resp = (httpStatus: number, body: unknown = {}) => ({ kind: "response" as const, httpStatus, body });
const decide = (httpStatus: number, body?: unknown) => decideCaptureOutcome(resp(httpStatus, body), 2450, "o:h");

describe("capture errors that are definitive release the buyer", () => {
  it.each([400, 401, 403, 404, 422])("HTTP %i with an unknown issue -> failed, redemption released", (status) => {
    const d = decide(status, { details: [{ issue: "TRANSACTION_REFUSED" }] });
    expect(d).toMatchObject({ nextState: "failed", releaseRedemption: true, issueLicence: false });
  });
  it.each([408, 409, 429, 500, 502, 503])("HTTP %i stays in flight", (status) => {
    expect(decide(status)).toMatchObject({ nextState: "capturing", releaseRedemption: false });
  });
  it("ORDER_ALREADY_CAPTURED stays in flight so it is read back, never released", () => {
    expect(decide(422, { details: [{ issue: "ORDER_ALREADY_CAPTURED" }] })).toMatchObject({ nextState: "capturing", releaseRedemption: false });
  });
});

const base: PlanInput = {
  state: "approved",
  earnedCents: 2450,
  customId: "o:h",
  captureId: null,
  captureAttempt: 0,
  captureStale: true,
  olderThan60s: true,
  olderThan60m: true,
  olderThan6h: false,
  mode: "read",
};
const approved = { status: 200, ok: true, json: { status: "APPROVED" } };

describe("planReconcile: approvals nobody finished", () => {
  it("created/approved + APPROVED at PayPal expires after 60 minutes, not before", () => {
    expect(planReconcile(base, approved)).toEqual({ do: "state", to: "expired" });
    expect(planReconcile({ ...base, state: "created" }, approved)).toEqual({ do: "state", to: "expired" });
    expect(planReconcile({ ...base, olderThan60m: false }, approved)).toEqual({ do: "none" });
  });
  it("capturing + APPROVED fails once attempts are exhausted or 60 minutes passed, even in read mode", () => {
    const c = { ...base, state: "capturing" as const, olderThan60m: false, captureAttempt: 1 };
    expect(planReconcile(c, approved)).toEqual({ do: "none" });
    expect(planReconcile({ ...c, captureAttempt: RECAPTURE_LIMIT }, approved)).toEqual({ do: "state", to: "failed" });
    expect(planReconcile({ ...c, olderThan60m: true }, approved)).toEqual({ do: "state", to: "failed" });
  });
  it("a capture call that may still be in flight is never failed", () => {
    expect(planReconcile({ ...base, state: "capturing", captureStale: false }, approved)).toEqual({ do: "none" });
  });
});

describe.skipIf(!HAVE_DB)("reconcile takes the redemption (real database, mocked PayPal)", () => {
  type Mod = { orders: typeof import("../src/store/orders"); db: typeof import("../src/store/db") };
  let m: Mod;
  const ids: string[] = [];

  async function insertCreated(buyerKey: string) {
    const id = randomUUID();
    const hash = `hash-${id.slice(0, 6)}`;
    await m.db.query(
      `insert into orders (id, state, session_id, buyer_key, snapshot_json, snapshot_hash, list_cents, earned_cents, discount_cents, paypal_order_id, expires_at)
       values ($1, 'created', $2, $3, '{"v":1}', $4, 4900, 2450, 2450, $5, now() + interval '15 minutes')`,
      [id, randomUUID(), buyerKey, hash, `PP-${id.slice(0, 8)}`],
    );
    ids.push(id);
    return { id, hash };
  }
  const completedOrder = (o: { id: string; hash: string }) => ({
    status: 200,
    ok: true,
    json: {
      status: "COMPLETED",
      purchase_units: [{ payments: { captures: [{ id: `CAP-${o.id.slice(0, 8)}`, status: "COMPLETED", amount: { value: "24.50", currency_code: "USD" }, custom_id: `${o.id}:${o.hash}` }] } }],
    },
  });

  beforeAll(async () => {
    m = { orders: await import("../src/store/orders"), db: await import("../src/store/db") };
  });
  beforeEach(() => {
    mocks.paypal.mockReset();
  });
  afterAll(async () => {
    if (!m || ids.length === 0) return;
    await m.db.query(`delete from redemptions where order_id = any($1::uuid[])`, [ids]);
    await m.db.query(`delete from orders where id = any($1::uuid[])`, [ids]);
  });

  it("an order captured outside our route claims the buyer's redemption when reconciled", async () => {
    const key = `github:${randomUUID()}`;
    const a = await insertCreated(key);
    mocks.paypal.mockResolvedValue(completedOrder(a));
    const o = await m.orders.reconcileOrder(a.id, "read");
    expect(o?.state).toBe("captured");
    const r = await m.db.query<{ order_id: string; state: string }>(`select order_id, state from redemptions where buyer_key = $1`, [key]);
    expect(r.rows[0]).toMatchObject({ order_id: a.id, state: "redeemed" });
  });

  it("a second order for a buyer who already redeemed ends as a visible mismatch with no licence", async () => {
    const key = `github:${randomUUID()}`;
    const a = await insertCreated(key);
    mocks.paypal.mockResolvedValue(completedOrder(a));
    await m.orders.reconcileOrder(a.id, "read");
    const b = await insertCreated(key);
    mocks.paypal.mockResolvedValue(completedOrder(b));
    const o = await m.orders.reconcileOrder(b.id, "read");
    expect(o?.state).toBe("mismatch");
    expect(o?.licence_key).toBeNull();
    const r = await m.db.query<{ order_id: string }>(`select order_id from redemptions where buyer_key = $1`, [key]);
    expect(r.rows).toEqual([{ order_id: a.id }]);
  });
});
