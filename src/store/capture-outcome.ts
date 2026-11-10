// Pure decision table for a PayPal capture response (docs/ARCHITECTURE.md section 3.5, facts P18/P21/P23).
// No I/O: the caller applies the Decision with compare-and-set writes.

import { fromPayPalValue } from "../paypal/money";

export type CaptureInput =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: "response"; httpStatus: number; body: any }
  | { kind: "network_error" };

export type Decision = {
  nextState: "captured" | "mismatch" | "capturing" | "failed" | "approved" | "created";
  capture?: { id: string; status: string; amountCents?: number; currency?: string; feeCents?: number; reason?: string };
  releaseRedemption: boolean;
  issueLicence: boolean;
  clientAction?: "restart";
  message: string;
};

const PROCESSING = "Payment is processing at PayPal. This page will confirm it shortly.";

function cents(value: unknown): number | undefined {
  try {
    return fromPayPalValue(value as string);
  } catch {
    return undefined;
  }
}

export function decideCaptureOutcome(input: CaptureInput, earnedCents: number): Decision {
  const keep = (message = PROCESSING): Decision => ({ nextState: "capturing", releaseRedemption: false, issueLicence: false, message });
  if (input.kind === "network_error") return keep();

  const { httpStatus, body } = input;
  if (httpStatus >= 200 && httpStatus < 300) {
    const c = body?.purchase_units?.[0]?.payments?.captures?.[0];
    if (typeof c?.id !== "string" || typeof c?.status !== "string") return keep();
    const capture = {
      id: c.id,
      status: c.status,
      amountCents: cents(c.amount?.value),
      currency: typeof c.amount?.currency_code === "string" ? c.amount.currency_code : undefined,
      feeCents: cents(c.seller_receivable_breakdown?.paypal_fee?.value),
      reason: typeof c.status_details?.reason === "string" ? c.status_details.reason : undefined,
    };
    switch (c.status) {
      case "COMPLETED":
        if (capture.currency === "USD" && capture.amountCents === earnedCents) {
          return { nextState: "captured", capture, releaseRedemption: false, issueLicence: true, message: "Payment captured." };
        }
        return { nextState: "mismatch", capture, releaseRedemption: false, issueLicence: false, message: "PayPal captured an amount that differs from the quoted price. No licence was issued." };
      case "PENDING":
        return { ...keep(`Payment is pending at PayPal${capture.reason ? ` (${capture.reason})` : ""}; the licence is issued when it completes.`), capture };
      case "DECLINED":
      case "FAILED":
        return { nextState: "failed", capture, releaseRedemption: true, issueLicence: false, message: "Payment failed. You were not charged and no licence was issued." };
      default:
        return keep();
    }
  }

  if (httpStatus === 422) {
    const issues: unknown[] = Array.isArray(body?.details) ? body.details.map((d: { issue?: unknown }) => d?.issue) : [];
    if (issues.includes("INSTRUMENT_DECLINED")) {
      return { nextState: "approved", releaseRedemption: true, issueLicence: false, clientAction: "restart", message: "Your payment method was declined. Choose another one." };
    }
    if (issues.includes("ORDER_NOT_APPROVED")) {
      return { nextState: "created", releaseRedemption: true, issueLicence: false, message: "Approve the payment first." };
    }
  }
  return keep();
}
