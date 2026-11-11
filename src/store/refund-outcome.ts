// Pure decisions for a refund (docs/specs/B5-buy-first-prove-later.md). No I/O: callers apply them with compare-and-set writes.

import { fromPayPalValue } from "../paypal/money";
import type { PayPalRead } from "./reconcile-plan";

export const REFUND_REJECT_ISSUES: readonly string[] = ["REFUND_AMOUNT_EXCEEDED", "REFUND_TIME_LIMIT_EXCEEDED", "CAPTURE_FULLY_REFUNDED", "REFUND_NOT_ALLOWED"];

/** What the buyer was overcharged: captured minus what the rules now say. Never negative. */
export function refundDue(capturedCents: number, earnedNowCents: number): number {
  if (!Number.isInteger(capturedCents) || !Number.isInteger(earnedNowCents)) return 0;
  return Math.max(0, capturedCents - earnedNowCents);
}

export type RefundInput =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | { kind: "response"; httpStatus: number; body: any }
  | { kind: "network_error" };

export type RefundDecision =
  | { kind: "completed"; refundId: string; paypalCents: number }
  | { kind: "mismatch"; refundId: string; paypalCents: number | undefined }
  | { kind: "pending"; refundId: string }
  | { kind: "rejected"; message: string }
  | { kind: "keep" };

const KEEP: RefundDecision = { kind: "keep" };

function cents(value: unknown): number | undefined {
  try {
    return fromPayPalValue(value as string);
  } catch {
    return undefined;
  }
}

export function decideRefundOutcome(input: RefundInput, expectedCents: number): RefundDecision {
  if (input.kind === "network_error") return KEEP;
  const { httpStatus, body } = input;
  if (httpStatus >= 200 && httpStatus < 300) {
    if (typeof body?.id !== "string" || typeof body?.status !== "string") return KEEP;
    switch (body.status) {
      case "COMPLETED": {
        const paypalCents = cents(body.amount?.value);
        const usd = body.amount?.currency_code === "USD";
        return usd && paypalCents === expectedCents
          ? { kind: "completed", refundId: body.id, paypalCents }
          : { kind: "mismatch", refundId: body.id, paypalCents };
      }
      case "PENDING":
        return { kind: "pending", refundId: body.id };
      case "CANCELLED":
      case "FAILED":
        return { kind: "rejected", message: "PayPal did not complete the refund. You can try again." };
      default:
        return KEEP;
    }
  }
  const issues: unknown[] = Array.isArray(body?.details) ? body.details.map((d: { issue?: unknown }) => d?.issue) : [];
  if (httpStatus === 400 || (httpStatus === 422 && issues.some((i) => typeof i === "string" && REFUND_REJECT_ISSUES.includes(i)))) {
    return { kind: "rejected", message: "PayPal refused the refund. You can try again." };
  }
  return KEEP;
}

export type RefundPlanInput = {
  state: "refunding" | "refund_pending";
  paypalRefundId: string | null;
  claimHash: string;
  expectedCents: number;
  mode: "read" | "act";
};
export type RefundPlan = { do: "none" } | { do: "decide"; decision: RefundDecision } | { do: "repost" };

/** `read` is GET refund for `refund_pending`, GET order for `refunding`. */
export function planRefundReconcile(i: RefundPlanInput, read: PayPalRead): RefundPlan {
  if (!read.ok) return { do: "none" };
  const decide = (body: unknown): RefundPlan => ({ do: "decide", decision: decideRefundOutcome({ kind: "response", httpStatus: 200, body }, i.expectedCents) });
  if (i.state === "refund_pending" && i.paypalRefundId) return decide(read.json);
  const refunds: unknown[] = read.json?.purchase_units?.[0]?.payments?.refunds ?? [];
  const ours = Array.isArray(refunds) ? refunds.find((r) => (r as { custom_id?: unknown })?.custom_id === i.claimHash) : undefined;
  if (ours) return decide(ours);
  return i.mode === "act" ? { do: "repost" } : { do: "none" };
}
