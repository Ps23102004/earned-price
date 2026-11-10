import { allow, clientIp } from "@/ratelimit";
import { guarded } from "@/session";
import { resetRedemptions } from "@/store/judge";
import { buyerKeysOf } from "@/store/redemptions";

// Demo only: exists when JUDGE_MODE=1 (the deployed demo runs with it on).
export function POST(req: Request) {
  if (process.env.JUDGE_MODE !== "1") return Response.json({ error: "not found" }, { status: 404 });
  return guarded(async (session) => {
    if (!allow(`reset:${clientIp(req.headers)}`, 20, 3_600_000)) {
      return { status: 429, body: { error: "too many resets, try again later" } };
    }
    const keys = buyerKeysOf(session);
    if (keys.length === 0) return { status: 400, body: { error: "pick a sample profile or sign in first" } };
    return resetRedemptions(keys);
  }, req);
}
