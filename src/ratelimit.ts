// Tiny in-memory fixed-window limiter, per process.
// Accepted risk: per process only and not shared across instances; move counters to the database if abuse appears.

import { createHmac, randomBytes } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

const MAX_KEYS = 10_000;
const OVERFLOW_SHARDS = 64;
const OVERFLOW_TOTAL = "__overflow_total__";
const shardSecret = randomBytes(32); // per process: attackers cannot pick which shard their keys land in
const hits = new Map<string, { count: number; resetAt: number }>();

function bump(key: string, windowMs: number, now: number): number {
  const h = hits.get(key);
  if (!h || h.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  return ++h.count;
}

export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (!hits.has(key) && hits.size >= MAX_KEYS) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    if (hits.size >= MAX_KEYS) {
      // Table full of live counters: never evict them. New keys share keyed overflow shards, and all
      // overflow together is capped at OVERFLOW_SHARDS × limit, so a flood cannot mint unbounded budget.
      const shard = createHmac("sha256", shardSecret).update(key).digest().readUInt32BE(0) % OVERFLOW_SHARDS;
      const total = bump(OVERFLOW_TOTAL, windowMs, now);
      const own = bump(`__overflow_${shard}__`, windowMs, now);
      return own <= limit && total <= limit * OVERFLOW_SHARDS;
    }
  }
  return bump(key, windowMs, now) <= limit;
}

/** Expand any valid IPv6 address to its 8 hextets (handles "::" and an embedded IPv4 tail). */
function hextets(ip: string): number[] {
  let addr = ip;
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4[1].split(".").map(Number);
    addr = addr.slice(0, -v4[1].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head, tail] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  const fill = tail !== undefined ? Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x, 16));
}

/** Rate-limit key for a client address: IPv4 as is, IPv4-mapped IPv6 as IPv4, other IPv6 by its /64. */
export function clientKey(ip: string): string {
  const bare = ip.replace(/%.*$/, ""); // drop zone id
  if (isIPv4(bare)) return bare;
  if (!isIPv6(bare)) return ip; // not an address: use the raw string
  const g = hextets(bare);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  }
  return g.slice(0, 4).map((x) => x.toString(16)).join(":") + "::/64";
}

/**
 * Client as seen by our own edge. Each trusted proxy appends one hop to x-forwarded-for, so the client is
 * TRUSTED_PROXY_HOPS entries from the right (default 1). Hops further left are client-supplied and ignored.
 * On Render the chain is "<client>, <Cloudflare edge>, <Render balancer>", so the client is 3 from the right
 * (verified on the deployed host, 2026-11-11), and CLIENT_IP_HEADER=cf-connecting-ip names the edge's own header.
 */
export function clientIp(
  headers: Headers,
  trustedHops = Number(process.env.TRUSTED_PROXY_HOPS ?? 1),
  ipHeader = process.env.CLIENT_IP_HEADER,
): string {
  // A header the host's edge sets itself (Render: cf-connecting-ip). Verified on the deployed host: a client-supplied
  // value is rejected or overwritten before it reaches the app. Used only when it holds a valid address; else XFF hops.
  const direct = ipHeader ? headers.get(ipHeader)?.trim() : undefined;
  if (direct && (isIPv4(direct) || isIPv6(direct))) return clientKey(direct);
  const hops = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const n = Number.isInteger(trustedHops) && trustedHops >= 1 ? trustedHops : 1;
  const ip = hops[hops.length - n];
  return ip ? clientKey(ip) : "local";
}

export function _resetForTests(): void {
  hits.clear();
}
