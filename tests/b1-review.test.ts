// Regression tests for the B1 review findings (pure helpers only; nothing here touches the network or the database).
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureLanding } from "../src/app/capture-landing";
import { bootProblems } from "../src/instrumentation";
import { allow, clientIp } from "../src/ratelimit";
import { customIdFor, verifyCustomId } from "../src/store/custom-id";
import { RECAPTURE_LIMIT, captureRequestId, planReconcile } from "../src/store/reconcile-plan";
import type { PlanInput } from "../src/store/reconcile-plan";
import { paypal } from "../src/paypal/client";
import { canonicalJson, snapshotHash } from "../src/facts/snapshot";
import { createHash } from "node:crypto";

const GOOD_ENV = {
  PAYPAL_ENV: "sandbox",
  LICENSE_HMAC_SECRET: "a-licence-secret",
  SESSION_SECRET: "s".repeat(32),
  APP_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgres://u:p@h/db",
};

describe("bootProblems (finding 1)", () => {
  it("is empty for a good environment", () => expect(bootProblems(GOOD_ENV)).toEqual([]));
  it.each([
    ["PAYPAL_ENV", { PAYPAL_ENV: "live" }],
    ["LICENSE_HMAC_SECRET", { LICENSE_HMAC_SECRET: undefined }],
    ["SESSION_SECRET", { SESSION_SECRET: undefined }],
    ["SESSION_SECRET", { SESSION_SECRET: "short" }],
    ["APP_URL", { APP_URL: undefined }],
    ["APP_URL", { APP_URL: "not a url" }],
    ["DATABASE_URL", { DATABASE_URL: "" }],
  ])("reports %s", (name, over) => {
    const p = bootProblems({ ...GOOD_ENV, ...over });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain(name);
  });
  it("reports every problem and never echoes a value", () => {
    const p = bootProblems({ PAYPAL_ENV: "live-secret-value", SESSION_SECRET: "tiny-secret" });
    expect(p.length).toBe(5);
    expect(p.join(" ")).not.toMatch(/live-secret-value|tiny-secret/);
  });
});

const base: PlanInput = {
  state: "capturing",
  earnedCents: 4900,
  customId: "o:h",
  captureId: null,
  captureAttempt: 1,
  captureStale: true,
  olderThan60s: true,
  olderThan6h: false,
  mode: "act",
};
const get = (status: number, json: unknown = {}) => ({ status, ok: status >= 200 && status < 300, json });
const orderJson = (status: string) => get(200, { status });
const completed = get(200, {
  status: "COMPLETED",
  purchase_units: [{ payments: { captures: [{ id: "C1", status: "COMPLETED", custom_id: "o:h", amount: { currency_code: "USD", value: "49.00" } }] } }],
});

describe("planReconcile, capturing without a capture id (findings 2, 8, 9)", () => {
  it("APPROVED and stale -> recapture, only in act mode, only below the attempt cap", () => {
    expect(planReconcile(base, orderJson("APPROVED"))).toEqual({ do: "recapture" });
    expect(planReconcile({ ...base, mode: "read" }, orderJson("APPROVED"))).toEqual({ do: "none" });
    expect(planReconcile({ ...base, captureStale: false }, orderJson("APPROVED"))).toEqual({ do: "none" });
    expect(planReconcile({ ...base, captureAttempt: RECAPTURE_LIMIT }, orderJson("APPROVED"))).toEqual({ do: "none" });
    expect(planReconcile({ ...base, captureAttempt: RECAPTURE_LIMIT - 1 }, orderJson("APPROVED"))).toEqual({ do: "recapture" });
  });
  it("CREATED / VOIDED / 404 act only when the capture attempt is stale", () => {
    for (const r of [orderJson("CREATED"), orderJson("VOIDED"), get(404)]) {
      expect(planReconcile({ ...base, captureStale: false }, r)).toEqual({ do: "none" });
    }
    expect(planReconcile(base, orderJson("CREATED"))).toEqual({ do: "state", to: "created" });
    expect(planReconcile(base, orderJson("VOIDED"))).toEqual({ do: "state", to: "failed" });
    expect(planReconcile(base, get(404))).toEqual({ do: "state", to: "failed" });
  });
  it("a 404 on a row younger than 60 s changes nothing", () => {
    expect(planReconcile({ ...base, olderThan60s: false }, get(404))).toEqual({ do: "none" });
  });
  it("COMPLETED -> the capture decision, regardless of staleness or mode", () => {
    const p = planReconcile({ ...base, captureStale: false, mode: "read" }, completed);
    expect(p).toMatchObject({ do: "decide", decision: { nextState: "captured", issueLicence: true } });
  });
  it("COMPLETED with another order's custom_id -> mismatch", () => {
    const p = planReconcile({ ...base, customId: "other:h" }, completed);
    expect(p).toMatchObject({ do: "decide", decision: { nextState: "mismatch", issueLicence: false } });
  });
  it("PayPal errors change nothing", () => {
    expect(planReconcile(base, get(500))).toEqual({ do: "none" });
  });
});

describe("planReconcile, capturing with a capture id", () => {
  const withId = { ...base, captureId: "C1" };
  it("COMPLETED capture -> decision; DECLINED -> failed; error -> none", () => {
    const cap = (status: string) => get(200, { id: "C1", status, custom_id: "o:h", amount: { currency_code: "USD", value: "49.00" } });
    expect(planReconcile(withId, cap("COMPLETED"))).toMatchObject({ do: "decide", decision: { nextState: "captured" } });
    expect(planReconcile(withId, cap("DECLINED"))).toMatchObject({ do: "decide", decision: { nextState: "failed" } });
    expect(planReconcile(withId, cap("PENDING"))).toMatchObject({ do: "decide", decision: { nextState: "capturing" } });
    expect(planReconcile(withId, get(500))).toEqual({ do: "none" });
  });
});

describe("planReconcile, created / approved (findings 8, 9)", () => {
  const created = { ...base, state: "created" as const, olderThan60s: false };
  it("404 acts only when the row is older than 60 s", () => {
    expect(planReconcile(created, get(404))).toEqual({ do: "none" });
    expect(planReconcile({ ...created, olderThan60s: true }, get(404))).toEqual({ do: "state", to: "cancelled" });
  });
  it("VOIDED -> cancelled; CREATED -> expired only after 6 h; APPROVED -> nothing, never a recapture", () => {
    expect(planReconcile(created, orderJson("VOIDED"))).toEqual({ do: "state", to: "cancelled" });
    expect(planReconcile(created, orderJson("CREATED"))).toEqual({ do: "none" });
    expect(planReconcile({ ...created, olderThan6h: true }, orderJson("CREATED"))).toEqual({ do: "state", to: "expired" });
    expect(planReconcile({ ...created, state: "approved" }, orderJson("APPROVED"))).toEqual({ do: "none" });
  });
  it("COMPLETED -> the capture decision", () => {
    expect(planReconcile(created, completed)).toMatchObject({ do: "decide", decision: { nextState: "captured" } });
  });
});

describe("captureRequestId (finding 5)", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  it("stays within PayPal's 38 characters up to the attempt cap and refuses beyond", () => {
    expect(captureRequestId(id, 1)).toBe("c-123e4567e89b12d3a456426614174000-1");
    expect(captureRequestId(id, RECAPTURE_LIMIT).length).toBeLessThanOrEqual(38);
    expect(() => captureRequestId(id, 1000)).toThrow(/too long/);
  });
});

describe("verifyCustomId (finding 7)", () => {
  const snap = canonicalJson({ version: 1, kind: "guest", fetchedAt: "2026-11-10T00:00:00.000Z" });
  const hash = createHash("sha256").update(snap, "utf8").digest("hex");
  it("needs both the order id and the recomputed hash to match", () => {
    expect(verifyCustomId(`ord-1:${hash}`, "ord-1", snap)).toBe(true);
    expect(verifyCustomId(`ord-2:${hash}`, "ord-1", snap)).toBe(false);
    expect(verifyCustomId(`ord-1:${"0".repeat(64)}`, "ord-1", snap)).toBe(false);
    expect(verifyCustomId(undefined, "ord-1", snap)).toBe(false);
    expect(verifyCustomId("no-separator", "ord-1", snap)).toBe(false);
  });
  it("customIdFor builds the same string create sends", () => {
    expect(customIdFor("ord-1", "abc")).toBe("ord-1:abc");
    expect(snapshotHash({ version: 1, kind: "guest", fetchedAt: "2026-11-10T00:00:00.000Z" })).toBe(hash);
  });
});

describe("captureLanding (finding 3)", () => {
  it("any body with an orderId goes to that receipt, including a 409 mismatch", () => {
    expect(captureLanding(409, { orderId: "o1", state: "mismatch" }, "q1")).toBe("o1");
    expect(captureLanding(200, { orderId: "o1" }, "q1")).toBe("o1");
  });
  it("400 / 403 / 404 without an orderId are the only 'not charged' failures", () => {
    for (const s of [400, 403, 404]) expect(captureLanding(s, { error: "x" }, "q1")).toBeNull();
  });
  it("anything else without an orderId lands on the quote's receipt, which reconciles", () => {
    for (const s of [409, 429, 500, 502]) expect(captureLanding(s, {}, "q1")).toBe("q1");
  });
});

describe("rate limit (finding 13)", () => {
  it("allows up to the limit inside a window, then refuses, then resets", () => {
    const k = "ip-a";
    for (let i = 0; i < 3; i++) expect(allow(k, 3, 1000, 0)).toBe(true);
    expect(allow(k, 3, 1000, 10)).toBe(false);
    expect(allow("ip-b", 3, 1000, 10)).toBe(true);
    expect(allow(k, 3, 1000, 1001)).toBe(true);
  });
  it("takes the right-most x-forwarded-for hop (added by our proxy), else 'local'", () => {
    // left hops are client-supplied: a spoofed first hop must not change the key
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" }))).toBe("10.0.0.1");
    expect(clientIp(new Headers({ "x-forwarded-for": "7.7.7.7, 10.0.0.1" }))).toBe("10.0.0.1");
    expect(clientIp(new Headers())).toBe("local");
  });
});

describe("token fetch is de-duplicated (finding 10)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("concurrent requests share one token call", async () => {
    process.env.PAYPAL_ENV = "sandbox";
    process.env.PAYPAL_CLIENT_ID = "id";
    process.env.PAYPAL_CLIENT_SECRET = "secret";
    let tokenCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/oauth2/token")) {
          tokenCalls++;
          await new Promise((r) => setTimeout(r, 20));
          return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );
    await Promise.all([paypal("GET", "/a"), paypal("GET", "/b"), paypal("GET", "/c")]);
    expect(tokenCalls).toBe(1);
  });
});

describe("rate limiter hard cap", () => {
  it("never evicts live counters; new keys share an overflow bucket when full", async () => {
    const { _resetForTests } = await import("../src/ratelimit");
    _resetForTests();
    const now = 1_000_000;
    expect(allow("attacker", 1, 60_000, now)).toBe(true);
    expect(allow("attacker", 1, 60_000, now)).toBe(false);
    for (let i = 0; i < 10_010; i++) allow(`flood${i}`, 5, 60_000, now);
    // the attacker's live counter survived the flood
    expect(allow("attacker", 1, 60_000, now)).toBe(false);
    // brand-new keys land in one of 64 overflow buckets; the 10 overflowed flood keys cannot exhaust them all
    const fresh = Array.from({ length: 200 }, (_, i) => allow(`fresh${i}`, 5, 60_000, now));
    expect(fresh.filter(Boolean).length).toBeGreaterThan(100);
    _resetForTests();
  });
  it("counts trusted proxy hops from the right", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.0.0.1" });
    expect(clientIp(h, 1)).toBe("10.0.0.1");
    expect(clientIp(h, 2)).toBe("1.2.3.4");
    expect(clientIp(h, 9)).toBe("local");
    expect(clientIp(new Headers({ "x-forwarded-for": "2001:db8:1:2:aaaa::1" }), 1)).toBe("2001:db8:1:2::/64");
    expect(clientIp(new Headers({ "x-forwarded-for": "2001:db8:1:2:bbbb::9" }), 1)).toBe("2001:db8:1:2::/64");
  });
});
