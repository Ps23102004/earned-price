import { describe, expect, it } from "vitest";
import { receiptSummary } from "../src/receipt-summary";

const order = (capture: unknown, refunds?: unknown[]) => ({ purchase_units: [{ payments: { captures: capture ? [capture] : [], refunds } }] });
const cap = (status: string, value = "49.00") => ({ id: "C", status, amount: { currency_code: "USD", value } });

describe("receiptSummary", () => {
  it("net = captured minus completed refunds, all from PayPal's figures", () => {
    const s = receiptSummary(order(cap("PARTIALLY_REFUNDED"), [{ status: "COMPLETED", amount: { value: "24.50" } }]));
    expect(s).toMatchObject({ paidCents: 4900, refundedCents: 2450, netCents: 2450, pendingRefund: false });
  });
  it("a pending refund is not subtracted", () => {
    expect(receiptSummary(order(cap("COMPLETED"), [{ status: "PENDING", amount: { value: "24.50" } }]))).toMatchObject({ refundedCents: 0, netCents: 4900, pendingRefund: true });
  });
  it("no paid capture means no figures", () => {
    expect(receiptSummary(order(cap("PENDING"))).paidCents).toBeUndefined();
    expect(receiptSummary(order(undefined)).netCents).toBeUndefined();
    expect(receiptSummary(null)).toMatchObject({ refundedCents: 0, pendingRefund: false });
  });
  it("unparseable amounts never produce a figure", () => {
    expect(receiptSummary(order(cap("COMPLETED", "49,00"))).paidCents).toBeUndefined();
  });
});
