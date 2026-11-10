// Pure decision for reconciling an open order against what PayPal says (docs/ARCHITECTURE.md section 3.5).
// The caller reads PayPal, asks for a Plan, then applies it with compare-and-set writes.

import { decideCaptureOutcome } from "./capture-outcome";
import type { Decision } from "./capture-outcome";

/** Capture attempts are numbered in the PayPal-Request-Id; beyond this, reconcile only reads. */
export const RECAPTURE_LIMIT = 20;

export type PlanInput = {
  state: "created" | "approved" | "capturing";
  earnedCents: number;
  customId: string;
  captureId: string | null;
  captureAttempt: number;
  /** capture_started_at is null or older than 30 s: the capture call is no longer in flight. */
  captureStale: boolean;
  olderThan60s: boolean;
  olderThan6h: boolean;
  /** "read" for GET paths: never starts a PayPal POST. "act" for POST routes. */
  mode: "read" | "act";
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PayPalRead = { status: number; ok: boolean; json: any };

export type Plan =
  | { do: "none" }
  | { do: "state"; to: "cancelled" | "expired" | "created" | "failed" }
  | { do: "decide"; decision: Decision }
  | { do: "recapture" };

const NONE: Plan = { do: "none" };

/** PayPal-Request-Id for a capture attempt: "c-<32 hex>-<attempt>". A too-long key is a bug, never a network error. */
export function captureRequestId(orderId: string, attempt: number): string {
  const id = `c-${orderId.replaceAll("-", "")}-${attempt}`;
  if (id.length > 38) throw new Error("capture request id too long");
  return id;
}

/** `r` is GET capture when the row has a capture id, otherwise GET order. */
export function planReconcile(o: PlanInput, r: PayPalRead): Plan {
  if (o.state === "capturing" && o.captureId) {
    if (!r.ok) return NONE;
    const body = { purchase_units: [{ payments: { captures: [r.json] } }] };
    return { do: "decide", decision: decideCaptureOutcome({ kind: "response", httpStatus: 200, body }, o.earnedCents, o.customId) };
  }

  // Everything below says "no capture exists" in some way, so a call that may still be in flight must not be undone.
  const settled = o.state !== "capturing" || o.captureStale;
  if (r.status === 404) {
    return o.olderThan60s && settled ? { do: "state", to: o.state === "capturing" ? "failed" : "cancelled" } : NONE;
  }
  if (!r.ok) return NONE;
  switch (r.json?.status) {
    case "COMPLETED":
      return { do: "decide", decision: decideCaptureOutcome({ kind: "response", httpStatus: 200, body: r.json }, o.earnedCents, o.customId) };
    case "VOIDED":
      return settled ? { do: "state", to: o.state === "capturing" ? "failed" : "cancelled" } : NONE;
    case "CREATED":
      if (o.state === "capturing") return settled ? { do: "state", to: "created" } : NONE;
      return o.olderThan6h ? { do: "state", to: "expired" } : NONE;
    case "APPROVED":
      return o.state === "capturing" && o.mode === "act" && o.captureStale && o.captureAttempt < RECAPTURE_LIMIT ? { do: "recapture" } : NONE;
    default:
      return NONE;
  }
}
