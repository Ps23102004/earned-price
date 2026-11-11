import { describe, expect, it } from "vitest";
import {
  REFUND_REJECT_ISSUES,
  decideRefundOutcome,
  planRefundReconcile,
  refundDue,
} from "../src/store/refund-outcome";

// Written from docs/specs/B5-buy-first-prove-later.md ("Pure modules") only.

const EXPECTED = 2400;
const HASH = "claim-hash-1";
const refund = (over: object = {}) => ({
  id: "REF1",
  status: "COMPLETED",
  amount: { currency_code: "USD", value: "24.00" },
  ...over,
});
const res = (httpStatus: number, body: unknown) => ({ kind: "response" as const, httpStatus, body });
const issue = (name: string) => res(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: name }] });

describe("REFUND_REJECT_ISSUES", () => {
  it("lists the four definitive refusal issues", () => {
    expect([...REFUND_REJECT_ISSUES].sort()).toEqual(
      ["CAPTURE_FULLY_REFUNDED", "REFUND_AMOUNT_EXCEEDED", "REFUND_NOT_ALLOWED", "REFUND_TIME_LIMIT_EXCEEDED"].sort(),
    );
  });
});

describe("refundDue", () => {
  it("is captured minus earnedNow", () => {
    expect(refundDue(4900, 2500)).toBe(2400);
  });
  it("is 0 when nothing is due", () => {
    expect(refundDue(4900, 4900)).toBe(0);
  });
  it("clamps a negative result to 0", () => {
    expect(refundDue(2500, 4900)).toBe(0);
  });
  it("handles zero captured", () => {
    expect(refundDue(0, 0)).toBe(0);
    expect(refundDue(0, 100)).toBe(0);
  });
  it.each([
    [4900.5, 2500],
    [4900, 2500.5],
    [4900.7, 2500.2],
    [0.5, 0.2],
    [Number.NaN, 100],
    [100, Number.NaN],
  ])("never returns NaN, a negative, or a non-integer (%s, %s)", (c, e) => {
    const r = refundDue(c, e);
    expect(Number.isNaN(r)).toBe(false);
    expect(Number.isInteger(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(0);
  });
});

describe("decideRefundOutcome, 2xx", () => {
  it("COMPLETED, USD, exact amount -> completed", () => {
    expect(decideRefundOutcome(res(201, refund()), EXPECTED)).toEqual({
      kind: "completed",
      refundId: "REF1",
      paypalCents: 2400,
    });
  });

  it("COMPLETED with a different amount -> mismatch carrying PayPal's amount", () => {
    expect(
      decideRefundOutcome(res(201, refund({ amount: { currency_code: "USD", value: "12.00" } })), EXPECTED),
    ).toEqual({ kind: "mismatch", refundId: "REF1", paypalCents: 1200 });
  });

  it("COMPLETED in a non-USD currency -> mismatch", () => {
    const d = decideRefundOutcome(res(201, refund({ amount: { currency_code: "EUR", value: "24.00" } })), EXPECTED);
    expect(d).toMatchObject({ kind: "mismatch", refundId: "REF1" });
  });

  it("COMPLETED with an unparseable amount string -> mismatch with paypalCents undefined", () => {
    const d = decideRefundOutcome(res(201, refund({ amount: { currency_code: "USD", value: "24.001" } })), EXPECTED);
    expect(d.kind).toBe("mismatch");
    if (d.kind === "mismatch") {
      expect(d.refundId).toBe("REF1");
      expect(d.paypalCents).toBeUndefined();
    }
  });

  it("PENDING -> pending with the refund id", () => {
    expect(decideRefundOutcome(res(201, refund({ status: "PENDING" })), EXPECTED)).toEqual({
      kind: "pending",
      refundId: "REF1",
    });
  });

  it.each(["CANCELLED", "FAILED"])("%s -> rejected with a message", (status) => {
    const d = decideRefundOutcome(res(201, refund({ status })), EXPECTED);
    expect(d.kind).toBe("rejected");
    if (d.kind === "rejected") expect(typeof d.message).toBe("string");
  });

  it("unknown status -> keep", () => {
    expect(decideRefundOutcome(res(201, refund({ status: "SOMETHING_NEW" })), EXPECTED)).toEqual({ kind: "keep" });
  });

  it("200 behaves like 201", () => {
    expect(decideRefundOutcome(res(200, refund()), EXPECTED)).toMatchObject({ kind: "completed" });
  });

  it("missing id -> keep", () => {
    const noId: Record<string, unknown> = { ...refund() };
    delete noId.id;
    expect(decideRefundOutcome(res(201, noId), EXPECTED)).toEqual({ kind: "keep" });
  });

  it("missing status -> keep", () => {
    const noStatus: Record<string, unknown> = { ...refund() };
    delete noStatus.status;
    expect(decideRefundOutcome(res(201, noStatus), EXPECTED)).toEqual({ kind: "keep" });
  });

  it("non-string id or status -> keep", () => {
    expect(decideRefundOutcome(res(201, refund({ id: 7 })), EXPECTED)).toEqual({ kind: "keep" });
    expect(decideRefundOutcome(res(201, refund({ status: 7 })), EXPECTED)).toEqual({ kind: "keep" });
  });
});

describe("decideRefundOutcome, errors", () => {
  it("HTTP 400 -> rejected", () => {
    const d = decideRefundOutcome(res(400, { name: "INVALID_REQUEST" }), EXPECTED);
    expect(d.kind).toBe("rejected");
    if (d.kind === "rejected") expect(typeof d.message).toBe("string");
  });

  it.each(["REFUND_AMOUNT_EXCEEDED", "REFUND_TIME_LIMIT_EXCEEDED", "CAPTURE_FULLY_REFUNDED", "REFUND_NOT_ALLOWED"])(
    "422 %s -> rejected",
    (name) => {
      expect(decideRefundOutcome(issue(name), EXPECTED).kind).toBe("rejected");
    },
  );

  it("422 with a rejecting issue among several details -> rejected", () => {
    const body = { details: [{ issue: "SOMETHING_ELSE" }, { issue: "REFUND_NOT_ALLOWED" }] };
    expect(decideRefundOutcome(res(422, body), EXPECTED).kind).toBe("rejected");
  });

  it("422 with an unknown issue -> keep", () => {
    expect(decideRefundOutcome(issue("TRANSIENT_WHO_KNOWS"), EXPECTED)).toEqual({ kind: "keep" });
  });

  it("422 whose details is not an array -> keep, no throw", () => {
    expect(decideRefundOutcome(res(422, { details: "REFUND_NOT_ALLOWED" }), EXPECTED)).toEqual({ kind: "keep" });
    expect(decideRefundOutcome(res(422, { details: { issue: "REFUND_NOT_ALLOWED" } }), EXPECTED)).toEqual({
      kind: "keep",
    });
    expect(decideRefundOutcome(res(422, {}), EXPECTED)).toEqual({ kind: "keep" });
    expect(decideRefundOutcome(res(422, null), EXPECTED)).toEqual({ kind: "keep" });
  });

  it.each([401, 404, 408, 409, 429, 500, 502, 503])("HTTP %i -> keep", (status) => {
    expect(decideRefundOutcome(res(status, { name: "X" }), EXPECTED)).toEqual({ kind: "keep" });
  });

  it("409 'previous call in progress' -> keep", () => {
    expect(decideRefundOutcome(res(409, { name: "PREVIOUS_REQUEST_IN_PROGRESS" }), EXPECTED)).toEqual({
      kind: "keep",
    });
  });

  it("network_error -> keep", () => {
    expect(decideRefundOutcome({ kind: "network_error" }, EXPECTED)).toEqual({ kind: "keep" });
  });
});

describe("planRefundReconcile: refund_pending", () => {
  const base = { state: "refund_pending" as const, paypalRefundId: "REF1", claimHash: HASH, expectedCents: EXPECTED };
  const read = (ok: boolean, json: unknown) => ({ status: ok ? 200 : 500, ok, json });

  it("GET not ok -> none (act and read)", () => {
    expect(planRefundReconcile({ ...base, mode: "act" }, read(false, refund()))).toEqual({ do: "none" });
    expect(planRefundReconcile({ ...base, mode: "read" }, read(false, refund()))).toEqual({ do: "none" });
  });

  it("ok, COMPLETED exact -> decide completed", () => {
    expect(planRefundReconcile({ ...base, mode: "read" }, read(true, refund()))).toEqual({
      do: "decide",
      decision: { kind: "completed", refundId: "REF1", paypalCents: 2400 },
    });
  });

  it("ok, COMPLETED different amount -> decide mismatch", () => {
    const plan = planRefundReconcile(
      { ...base, mode: "act" },
      read(true, refund({ amount: { currency_code: "USD", value: "10.00" } })),
    );
    expect(plan).toEqual({ do: "decide", decision: { kind: "mismatch", refundId: "REF1", paypalCents: 1000 } });
  });

  it("ok, PENDING -> decide pending", () => {
    expect(planRefundReconcile({ ...base, mode: "act" }, read(true, refund({ status: "PENDING" })))).toEqual({
      do: "decide",
      decision: { kind: "pending", refundId: "REF1" },
    });
  });

  it.each(["FAILED", "CANCELLED"])("ok, %s -> decide rejected", (status) => {
    const plan = planRefundReconcile({ ...base, mode: "act" }, read(true, refund({ status })));
    expect(plan.do).toBe("decide");
    if (plan.do === "decide") expect(plan.decision.kind).toBe("rejected");
  });
});

describe("planRefundReconcile: refunding", () => {
  const base = { state: "refunding" as const, paypalRefundId: null, claimHash: HASH, expectedCents: EXPECTED };
  const order = (refunds?: unknown) => ({
    purchase_units: [{ payments: refunds === undefined ? {} : { refunds } }],
  });
  const read = (json: unknown, ok = true) => ({ status: ok ? 200 : 500, ok, json });
  const withHash = (over: object = {}) => refund({ custom_id: HASH, ...over });

  it("GET not ok -> none (act and read)", () => {
    expect(planRefundReconcile({ ...base, mode: "act" }, read(order([withHash()]), false))).toEqual({ do: "none" });
    expect(planRefundReconcile({ ...base, mode: "read" }, read(order([withHash()]), false))).toEqual({ do: "none" });
  });

  it("matching custom_id, COMPLETED exact -> decide completed", () => {
    expect(planRefundReconcile({ ...base, mode: "read" }, read(order([withHash()])))).toEqual({
      do: "decide",
      decision: { kind: "completed", refundId: "REF1", paypalCents: 2400 },
    });
  });

  it("matching custom_id, COMPLETED different amount -> decide mismatch", () => {
    const plan = planRefundReconcile(
      { ...base, mode: "act" },
      read(order([withHash({ amount: { currency_code: "USD", value: "5.00" } })])),
    );
    expect(plan).toEqual({ do: "decide", decision: { kind: "mismatch", refundId: "REF1", paypalCents: 500 } });
  });

  it("matching custom_id, PENDING -> decide pending", () => {
    expect(planRefundReconcile({ ...base, mode: "act" }, read(order([withHash({ status: "PENDING" })])))).toEqual({
      do: "decide",
      decision: { kind: "pending", refundId: "REF1" },
    });
  });

  it.each(["FAILED", "CANCELLED"])("matching custom_id, %s -> decide rejected", (status) => {
    const plan = planRefundReconcile({ ...base, mode: "act" }, read(order([withHash({ status })])));
    expect(plan.do).toBe("decide");
    if (plan.do === "decide") expect(plan.decision.kind).toBe("rejected");
  });

  it("picks the refund whose custom_id equals the claim hash among several", () => {
    const other = refund({ id: "OTHER", custom_id: "someone-else", amount: { currency_code: "USD", value: "1.00" } });
    const plan = planRefundReconcile({ ...base, mode: "act" }, read(order([other, withHash({ id: "MINE" })])));
    expect(plan).toEqual({
      do: "decide",
      decision: { kind: "completed", refundId: "MINE", paypalCents: 2400 },
    });
  });

  it("only non-matching custom_id: act -> repost, read -> none", () => {
    const o = order([refund({ custom_id: "different" })]);
    expect(planRefundReconcile({ ...base, mode: "act" }, read(o))).toEqual({ do: "repost" });
    expect(planRefundReconcile({ ...base, mode: "read" }, read(o))).toEqual({ do: "none" });
  });

  it("refund without any custom_id does not match: act -> repost", () => {
    expect(planRefundReconcile({ ...base, mode: "act" }, read(order([refund()])))).toEqual({ do: "repost" });
  });

  it("empty refunds array: act -> repost, read -> none", () => {
    expect(planRefundReconcile({ ...base, mode: "act" }, read(order([])))).toEqual({ do: "repost" });
    expect(planRefundReconcile({ ...base, mode: "read" }, read(order([])))).toEqual({ do: "none" });
  });

  it("no refunds array at all: act -> repost, read -> none", () => {
    expect(planRefundReconcile({ ...base, mode: "act" }, read(order()))).toEqual({ do: "repost" });
    expect(planRefundReconcile({ ...base, mode: "read" }, read(order()))).toEqual({ do: "none" });
  });
});
