import { allow, clientIp } from "@/ratelimit";
import { guarded } from "@/session";
import { createGuestQuote } from "@/store/orders";

export function POST(req: Request) {
  return guarded(async (session) => {
    if (!allow(`quote:${clientIp(req.headers)}`, 200, 3_600_000)) {
      return { status: 429, body: { error: "too many requests, try again later" } };
    }
    const r = await createGuestQuote(session.sid);
    session.hasOrders = true;
    await session.save();
    return r;
  }, req);
}
