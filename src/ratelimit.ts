// Tiny in-memory fixed-window limiter. ponytail: per process and the first x-forwarded-for hop is client-supplied;
// move to the database or the platform's limiter if this ever faces real abuse.

const hits = new Map<string, { count: number; resetAt: number }>();

export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  const h = hits.get(key);
  if (!h || h.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  return ++h.count <= limit;
}

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
