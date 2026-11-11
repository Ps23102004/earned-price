import { isSampleName } from "@/facts/samples";
import { readLimitedJson } from "@/http";
import { allow, clientIp } from "@/ratelimit";
import { guarded } from "@/session";
import { claimRefund } from "@/store/refunds";

export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (session) => {
    const ip = clientIp(req.headers);
    if (!allow(`claim:${ip}`, 20, 3_600_000)) return { status: 429, body: { error: "too many requests, try again later" } };
    const { id } = await ctx.params;
    const body = await readLimitedJson(req, 1024);
    if (!body) return { status: 400, body: { error: "invalid request" } };
    if (Object.keys(body).some((k) => k !== "sample")) return { status: 400, body: { error: "the refund amount is computed server-side" } };
    const sample = (body as { sample?: unknown }).sample;
    if ("sample" in body && !isSampleName(sample)) return { status: 400, body: { error: "unknown sample" } };
    if (isSampleName(sample) && session.sample !== sample) {
      session.sample = sample;
      await session.save();
    }
    return claimRefund(id, { sid: session.sid, ip, github: session.github, sample: isSampleName(sample) ? sample : session.sample, activeRuleId: session.activeRuleId });
  }, req);
}
