// Where the buyer goes after the capture request answers. Pure.

/**
 * Receipt order id to open, or null when the failure happened before any money could move (400/403/404 without an
 * orderId). A response carrying an orderId always goes to its receipt, a 409 "mismatch" included: money moved there.
 * Anything else without an orderId also goes to the quote's receipt, which reconciles with PayPal.
 */
export function captureLanding(status: number, json: Record<string, unknown> | null, quoteOrderId: string): string | null {
  if (typeof json?.orderId === "string") return json.orderId;
  return status === 400 || status === 403 || status === 404 ? null : quoteOrderId;
}
