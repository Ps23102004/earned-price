import { guarded } from "@/session";
import { createPayPalOrder } from "@/store/orders";

export function POST(req: Request) {
  return guarded(async (session) => {
    const body = await req.json().catch(() => null);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return { status: 400, body: { error: "orderId is required" } };
    }
    if (Object.keys(body).some((k) => k !== "orderId")) {
      return { status: 400, body: { error: "prices are computed server-side" } };
    }
    if (typeof body.orderId !== "string") return { status: 400, body: { error: "orderId is required" } };
    return createPayPalOrder(body.orderId, session.sid);
  }, req);
}
