// Deterministic licence key from a PayPal capture id: same capture -> same key, no key stored elsewhere.

import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // RFC 4648 base32

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function licenceKey(captureId: string): string {
  const secret = process.env.LICENSE_HMAC_SECRET;
  if (!secret) throw new Error("LICENSE_HMAC_SECRET is not set");
  return "EP-" + base32(createHmac("sha256", secret).update(captureId).digest()).slice(0, 20);
}
