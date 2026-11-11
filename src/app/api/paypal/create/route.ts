import { readLimitedJson } from "@/http";
import { allow, clientIp } from "@/ratelimit";
import { guarded } from "@/session";
import { createPayPalOrder } from "@/store/orders";

export function POST(req: Request) {
  return guarded(async (session) => {
    if (!allow(`create:${clientIp(req.headers)}`, 60, 3_600_000)) {
      return { status: 429, body: { error: "too many requests, try again later" } };
    }
    const body = await readLimitedJson(req, 1024);
    if (!body) {
      return { status: 400, body: { error: "orderId is required" } };
    }
    if (Object.keys(body).some((k) => k !== "orderId")) {
      return { status: 400, body: { error: "prices are computed server-side" } };
    }
    if (typeof body.orderId !== "string") return { status: 400, body: { error: "orderId is required" } };
    // The total cap is charged inside, only for a valid order this session owns, so unauthenticated callers cannot use it up.
    return createPayPalOrder(body.orderId, session.sid, () => allow(`create:sid:${session.sid}`, 30, 3_600_000) && allow("create:global", 1000, 3_600_000));
  }, req);
}
