// Tiny in-memory fixed-window limiter, per process.
// ponytail: per process only; move counters to the database if this ever faces real abuse.

const MAX_KEYS = 10_000;
const OVERFLOW = "__overflow__";
const hits = new Map<string, { count: number; resetAt: number }>();

export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (!hits.has(key) && hits.size >= MAX_KEYS) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    // Still full of live counters: never evict them (that would reset an attacker's own count);
    // new keys share one overflow bucket instead, so a key flood throttles itself.
    if (hits.size >= MAX_KEYS) key = OVERFLOW;
  }
  const h = hits.get(key);
  if (!h || h.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  return ++h.count <= limit;
}

/**
 * Client IP as seen by our own edge. Each trusted proxy appends one hop to x-forwarded-for, so the client is
 * TRUSTED_PROXY_HOPS entries from the right (default 1 = one platform proxy). Hops further left are
 * client-supplied and ignored. Verify the chain on the deployed host and set TRUSTED_PROXY_HOPS to match.
 */
export function clientIp(headers: Headers, trustedHops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1)): string {
  const hops = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const n = Number.isInteger(trustedHops) && trustedHops >= 1 ? trustedHops : 1;
  return hops[hops.length - n] ?? "local";
}

export function _resetForTests(): void {
  hits.clear();
}
