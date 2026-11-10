import { guarded } from "@/session";
import { capture } from "@/store/orders";

export function POST(req: Request) {
  return guarded(async (session) => {
    const body = await req.json().catch(() => null);
    if (typeof body?.paypalOrderId !== "string" || body.paypalOrderId.length > 64) {
      return { status: 400, body: { error: "paypalOrderId is required" } };
    }
    return capture(body.paypalOrderId, session.sid);
  }, req);
}
