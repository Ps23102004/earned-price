import { allow, clientIp } from "@/ratelimit";
import { guarded } from "@/session";
import { huntAction, readJson } from "@/store/merchant";

export function POST(req: Request) {
  return guarded(async () => {
    const ip = clientIp(req.headers);
    if (!allow(`merchant:${ip}`, 300, 3_600_000)) return { status: 429, body: { error: "too many requests, try again later" } };
    const body = await readJson(req);
    if (!body) return { status: 400, body: { error: "invalid request" } };
    return huntAction(body.ruleId, ip);
  }, req);
}
