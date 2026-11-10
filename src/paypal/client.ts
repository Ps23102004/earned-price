// PayPal REST client: sandbox host only, cached token, one request helper. No retries, no business logic.

import { Buffer } from "node:buffer";

export const SANDBOX_HOST = "https://api-m.sandbox.paypal.com";

/** Refuse to run against anything but the sandbox. Called before every request and at server start. */
export function assertSandbox(env: Record<string, string | undefined> = process.env): void {
  if (env.PAYPAL_ENV !== "sandbox") {
    throw new Error('PAYPAL_ENV must be exactly "sandbox"; refusing to start');
  }
}

let cached: { token: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set");
  const res = await fetch(`${SANDBOX_HOST}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) throw new Error(`PayPal token request failed: HTTP ${res.status}`);
  cached = { token: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 300) - 60) * 1000 };
  return cached.token;
}

// PayPal bodies are parsed loosely here; callers read specific fields and check them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PayPalResponse = { status: number; ok: boolean; json: any; debugId?: string };

export async function paypal(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; requestId?: string; representation?: boolean } = {},
): Promise<PayPalResponse> {
  assertSandbox();
  if (opts.requestId && opts.requestId.length > 38) throw new Error("PayPal-Request-Id must be at most 38 characters");
  const res = await fetch(`${SANDBOX_HOST}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      ...(opts.requestId ? { "PayPal-Request-Id": opts.requestId } : {}),
      ...(opts.representation ? { Prefer: "return=representation" } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, json, debugId: json?.debug_id };
}
