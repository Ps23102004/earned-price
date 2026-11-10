// Signed OAuth state: base64url(json).base64url(hmac). Pure apart from node:crypto.

import { createHmac, timingSafeEqual } from "node:crypto";

type Payload = { nonce: string; sid: string; returnTo?: string };

const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest();

export function signState(payload: Payload, secret: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: now })).toString("base64url");
  return `${body}.${sign(body, secret).toString("base64url")}`;
}

export function verifyState(token: string, secret: string, now = Date.now(), maxAgeMs = 600_000): Payload | null {
  try {
    const parts = typeof token === "string" ? token.split(".") : [];
    if (parts.length !== 2) return null;
    const given = Buffer.from(parts[1], "base64url");
    const want = sign(parts[0], secret);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    const p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (typeof p !== "object" || p === null) return null;
    if (typeof p.nonce !== "string" || typeof p.sid !== "string" || typeof p.iat !== "number") return null;
    if (now - p.iat > maxAgeMs || p.iat > now + 60_000) return null;
    return { nonce: p.nonce, sid: p.sid, ...(typeof p.returnTo === "string" ? { returnTo: p.returnTo } : {}) };
  } catch {
    return null;
  }
}

/** Only a same-site path survives: one leading slash, no scheme, no protocol-relative or backslash tricks. */
export function safeReturnTo(v: unknown): string {
  if (typeof v !== "string" || v.length > 200 || v.includes(":")) return "/";
  if (!/^\/[^/\\]/.test(v) || /[\u0000-\u001f\u007f]/.test(v)) return "/";
  return v;
}
