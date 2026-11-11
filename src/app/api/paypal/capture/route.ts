import { readLimitedJson } from "@/http";
import { allow, clientIp } from "@/ratelimit";
import { guarded } from "@/session";
import { capture } from "@/store/orders";

export function POST(req: Request) {
  return guarded(async (session) => {
    if (!allow(`capture:${clientIp(req.headers)}`, 120, 3_600_000)) {
      return { status: 429, body: { error: "too many requests, try again later" } };
    }
    const body = await readLimitedJson(req, 1024);
    if (typeof body?.paypalOrderId !== "string" || body.paypalOrderId.length > 64) {
      return { status: 400, body: { error: "paypalOrderId is required" } };
    }
    return capture(body.paypalOrderId, session.sid);
  }, req);
}
