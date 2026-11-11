import { isSampleName } from "@/facts/samples";
import { allow, clientIp } from "@/ratelimit";
import { guarded } from "@/session";
import { createQuote } from "@/store/quote";

export function POST(req: Request) {
  return guarded(async (session) => {
    const ip = clientIp(req.headers);
    if (!allow(`quote:${ip}`, 200, 3_600_000)) {
      return { status: 429, body: { error: "too many requests, try again later" } };
    }
    const text = await req.text();
    let body: unknown = {};
    if (text.trim() !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return { status: 400, body: { error: "invalid request" } };
    const sample = (body as { sample?: unknown }).sample;
    if ("sample" in body && !isSampleName(sample)) return { status: 400, body: { error: "unknown sample" } };

    const r = await createQuote({ sid: session.sid, ip, github: session.github, activeRuleId: session.activeRuleId, sample: isSampleName(sample) ? sample : undefined });
    if (r.status === 200) {
      // Save only what changed: a quote can take seconds, and re-sealing the whole cookie would undo a publish or sign-out made meanwhile.
      const changed = !session.hasOrders || (isSampleName(sample) && session.sample !== sample);
      session.hasOrders = true;
      if (isSampleName(sample)) session.sample = sample;
      if (changed) await session.save();
    }
    return r;
  }, req);
}
