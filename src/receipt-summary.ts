// What the buyer paid, as PayPal recorded it. Pure: reads PayPal's order object only, never our database.

import { fromPayPalValue } from "./paypal/money";

export type ReceiptSummary = {
  paidCents?: number;
  refundedCents: number;
  /** paid minus completed refunds; undefined until a capture exists */
  netCents?: number;
  pendingRefund: boolean;
};

const PAID = ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"];

function cents(m: unknown): number | undefined {
  try {
    return fromPayPalValue((m as { value?: string })?.value as string);
  } catch {
    return undefined;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function receiptSummary(po: any): ReceiptSummary {
  const payments = po?.purchase_units?.[0]?.payments;
  const capture = payments?.captures?.[0];
  const paidCents = capture && PAID.includes(capture.status) ? cents(capture.amount) : undefined;
  const refunds: { status?: string; amount?: unknown }[] = Array.isArray(payments?.refunds) ? payments.refunds : [];
  const refundedCents = refunds.filter((r) => r.status === "COMPLETED").reduce((sum, r) => sum + (cents(r.amount) ?? 0), 0);
  const pendingRefund = refunds.some((r) => r.status === "PENDING");
  return { paidCents, refundedCents, netCents: paidCents === undefined ? undefined : Math.max(0, paidCents - refundedCents), pendingRefund };
}
