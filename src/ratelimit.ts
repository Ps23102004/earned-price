// Tiny in-memory fixed-window limiter, per process.
// ponytail: per process only; move counters to the database if this ever faces real abuse.

const MAX_KEYS = 10_000;
const OVERFLOW_SHARDS = 64;

// Spread overflow by a cheap string hash so one flood cannot spend every newcomer's budget.
function overflowKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `__overflow_${h % OVERFLOW_SHARDS}`;
}
const hits = new Map<string, { count: number; resetAt: number }>();

export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (!hits.has(key) && hits.size >= MAX_KEYS) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    // Still full of live counters: never evict them (that would reset an attacker's own count);
    // new keys go to one of a few overflow buckets instead, so a key flood mostly throttles itself.
    if (hits.size >= MAX_KEYS) key = overflowKey(key);
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
  const ip = hops[hops.length - n];
  if (!ip) return "local";
  // IPv6: one subscriber usually owns a whole /64, so count the /64 as one client.
  // ponytail: naive split; "::"-compressed prefixes group less precisely. Use a real parser if abuse shows up.
  return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") + "::/64" : ip;
}

export function _resetForTests(): void {
  hits.clear();
}
