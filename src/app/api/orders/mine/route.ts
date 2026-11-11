import { allow, clientIp } from "@/ratelimit";
import { guarded } from "@/session";
import { listForSession } from "@/store/orders";

export function GET(req: Request) {
  return guarded(async (session) => {
    if (!allow(`mine:${clientIp(req.headers)}`, 600, 3_600_000)) {
      return { status: 429, body: { error: "too many requests, try again later" } };
    }
    return listForSession(session.sid);
  });
}
