// Tiny in-memory fixed-window limiter, per process.
// ponytail: per process only; move counters to the database if this ever faces real abuse.

const MAX_KEYS = 10_000;
const hits = new Map<string, { count: number; resetAt: number }>();

export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (hits.size >= MAX_KEYS) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    // Still full of live keys (e.g. spoofed-key flood): drop the oldest entries; Map keeps insertion order.
    for (const k of hits.keys()) {
      if (hits.size < MAX_KEYS) break;
      hits.delete(k);
    }
  }
  const h = hits.get(key);
  if (!h || h.resetAt <= now) {
    hits.delete(key);
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  return ++h.count <= limit;
}

/**
 * Client IP as seen by our own proxy: the right-most x-forwarded-for hop is the one Render's edge appends;
 * every hop to its left is client-supplied and must not be trusted.
 */
export function clientIp(headers: Headers): string {
  const hops = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return hops.at(-1) || "local";
}

export function _resetForTests(): void {
  hits.clear();
}
