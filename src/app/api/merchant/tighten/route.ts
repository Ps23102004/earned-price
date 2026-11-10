import { allow, clientIp } from "@/ratelimit";
import { guarded } from "@/session";
import { readJson, tightenAction } from "@/store/merchant";

export function POST(req: Request) {
  return guarded(async () => {
    if (!allow(`merchant:${clientIp(req.headers)}`, 300, 3_600_000)) return { status: 429, body: { error: "too many requests, try again later" } };
    const body = await readJson(req);
    if (!body) return { status: 400, body: { error: "invalid request" } };
    return tightenAction(body.ruleId, body.tierId, body.spiritCheck);
  }, req);
}
