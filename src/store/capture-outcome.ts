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

/** `expectedCustomId` is "<orderId>:<snapshotHash>"; a COMPLETED capture that carries another custom_id is not ours. */
export function decideCaptureOutcome(input: CaptureInput, earnedCents: number, expectedCustomId: string): Decision {
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
      case "COMPLETED": {
        const customId = c.custom_id ?? body?.purchase_units?.[0]?.custom_id;
        if (customId !== expectedCustomId) {
          return { nextState: "mismatch", capture, releaseRedemption: false, issueLicence: false, message: "PayPal's record does not belong to this order. No licence was issued." };
        }
        if (capture.currency === "USD" && capture.amountCents === earnedCents) {
          return { nextState: "captured", capture, releaseRedemption: false, issueLicence: true, message: "Payment captured." };
        }
        return { nextState: "mismatch", capture, releaseRedemption: false, issueLicence: false, message: "PayPal captured an amount that differs from the quoted price. No licence was issued." };
      }
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
  // Any other client error says PayPal did not capture (ORDER_ALREADY_CAPTURED excepted: that one must be read back).
  // 408/409/429 are transient. Keeping these "in flight" would strand the buyer's redemption for good.
  const definitive = httpStatus >= 400 && httpStatus < 500 && ![408, 409, 429].includes(httpStatus);
  const alreadyCaptured = Array.isArray(body?.details) && body.details.some((d: { issue?: unknown }) => d?.issue === "ORDER_ALREADY_CAPTURED");
  if (definitive && !alreadyCaptured) {
    return { nextState: "failed", releaseRedemption: true, issueLicence: false, message: "PayPal could not complete this payment. You were not charged. Start a new order." };
  }
  return keep();
}
