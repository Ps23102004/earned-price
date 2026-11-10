import { describe, expect, it } from "vitest";
import { decideCaptureOutcome } from "../src/store/capture-outcome";

const EARNED = 4900;
const order = (cap: object) => ({ purchase_units: [{ payments: { captures: [cap] } }] });
const cap = (over: object = {}) => ({
  id: "CAP1",
  status: "COMPLETED",
  amount: { currency_code: "USD", value: "49.00" },
  seller_receivable_breakdown: { paypal_fee: { currency_code: "USD", value: "1.91" } },
  ...over,
});
const res = (httpStatus: number, body: unknown) => ({ kind: "response" as const, httpStatus, body });
const issue = (name: string) => res(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: name }] });

describe("decideCaptureOutcome", () => {
  it("COMPLETED, USD, amount == earned -> captured with licence", () => {
    const d = decideCaptureOutcome(res(201, order(cap())), EARNED);
    expect(d).toMatchObject({ nextState: "captured", issueLicence: true, releaseRedemption: false });
    expect(d.capture).toMatchObject({ id: "CAP1", status: "COMPLETED", amountCents: 4900, currency: "USD", feeCents: 191 });
    expect(d.clientAction).toBeUndefined();
  });

  it("COMPLETED with a different amount -> mismatch, no licence, redemption kept", () => {
    const d = decideCaptureOutcome(res(201, order(cap({ amount: { currency_code: "USD", value: "24.50" } }))), EARNED);
    expect(d).toMatchObject({ nextState: "mismatch", issueLicence: false, releaseRedemption: false });
    expect(d.capture).toMatchObject({ id: "CAP1", amountCents: 2450 });
  });

  it("COMPLETED in a different currency -> mismatch", () => {
    const d = decideCaptureOutcome(res(201, order(cap({ amount: { currency_code: "EUR", value: "49.00" } }))), EARNED);
    expect(d).toMatchObject({ nextState: "mismatch", issueLicence: false });
  });

  it("COMPLETED with an unreadable amount -> mismatch, never a licence", () => {
    const d = decideCaptureOutcome(res(201, order(cap({ amount: { currency_code: "USD", value: "49.001" } }))), EARNED);
    expect(d).toMatchObject({ nextState: "mismatch", issueLicence: false });
    expect(d.capture?.amountCents).toBeUndefined();
  });

  it("PENDING -> capturing, stores id and reason, redemption kept", () => {
    const d = decideCaptureOutcome(res(201, order(cap({ status: "PENDING", status_details: { reason: "PENDING_REVIEW" } }))), EARNED);
    expect(d).toMatchObject({ nextState: "capturing", issueLicence: false, releaseRedemption: false });
    expect(d.capture).toMatchObject({ id: "CAP1", status: "PENDING", reason: "PENDING_REVIEW" });
    expect(d.message).toContain("PENDING_REVIEW");
  });

  it.each(["DECLINED", "FAILED"])("%s (even on HTTP 201) -> failed, redemption released", (status) => {
    const d = decideCaptureOutcome(res(201, order(cap({ status }))), EARNED);
    expect(d).toMatchObject({ nextState: "failed", issueLicence: false, releaseRedemption: true });
    expect(d.capture).toMatchObject({ id: "CAP1", status });
  });

  it("422 INSTRUMENT_DECLINED -> approved + restart, released", () => {
    expect(decideCaptureOutcome(issue("INSTRUMENT_DECLINED"), EARNED)).toMatchObject({
      nextState: "approved",
      clientAction: "restart",
      releaseRedemption: true,
      issueLicence: false,
    });
  });

  it("422 ORDER_NOT_APPROVED -> created, released, no restart", () => {
    const d = decideCaptureOutcome(issue("ORDER_NOT_APPROVED"), EARNED);
    expect(d).toMatchObject({ nextState: "created", releaseRedemption: true, issueLicence: false });
    expect(d.clientAction).toBeUndefined();
  });

  it.each([
    ["422 ORDER_ALREADY_CAPTURED", issue("ORDER_ALREADY_CAPTURED")],
    ["422 unknown issue", issue("SOMETHING_NEW")],
    ["422 with no details", res(422, {})],
    ["400", res(400, { name: "INVALID_REQUEST" })],
    ["404", res(404, null)],
    ["429", res(429, { name: "RATE_LIMIT_REACHED" })],
    ["500", res(500, { name: "INTERNAL_SERVER_ERROR" })],
    ["503 with raw body", res(503, { raw: "<html>" })],
    ["2xx with null body", res(200, null)],
    ["2xx without captures", res(201, { purchase_units: [{ payments: {} }] })],
    ["2xx capture without id", res(201, order({ status: "COMPLETED" }))],
    ["2xx with an unknown capture status", res(201, order(cap({ status: "REFUNDED" })))],
    ["network_error", { kind: "network_error" as const }],
  ])("%s -> stays capturing, redemption kept, no licence", (_name, input) => {
    const d = decideCaptureOutcome(input, EARNED);
    expect(d).toMatchObject({ nextState: "capturing", releaseRedemption: false, issueLicence: false });
    expect(d.clientAction).toBeUndefined();
    expect(d.message).toBeTruthy();
  });
});
