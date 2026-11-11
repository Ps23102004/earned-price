// Cookie session (iron-session) plus the two request-boundary helpers every API route shares.

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getIronSession } from "iron-session";
import type { IronSession } from "iron-session";
import type { SampleName } from "./facts/samples";

export type SessionData = {
  sid: string;
  hasOrders?: boolean;
  github?: { id: number; login: string; avatarUrl: string };
  sample?: SampleName;
  /** The merchant rule published to this browser's shop only; absent means the default rule. */
  activeRuleId?: string;
};
export type Session = IronSession<SessionData> & { sid: string };
export type ApiResult = { status: number; body: unknown };

export async function getSession(): Promise<Session> {
  const session = await getIronSession<SessionData>(await cookies(), {
    cookieName: "ep_session",
    password: process.env.SESSION_SECRET as string,
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" },
  });
  if (!session.sid) {
    await connection(); // request-time only: a random id must never be computed during prerender
    session.sid = randomUUID();
    // Server components cannot set cookies; there the sid just lasts for the render.
    await session.save().catch(() => {});
  }
  return session as Session;
}

/**
 * Wraps a route handler: for POST pass `req` and its Origin must equal APP_URL (else 403); the session is read
 * before the try block so Next's prerender interruption is never swallowed; unexpected errors become JSON 500s.
 */
export async function guarded(fn: (session: Session) => Promise<ApiResult>, req?: Request): Promise<Response> {
  if (req) {
    const appUrl = process.env.APP_URL;
    if (!appUrl || req.headers.get("origin") !== new URL(appUrl).origin) {
      return Response.json({ error: "bad origin" }, { status: 403 });
    }
  }
  const session = await getSession();
  try {
    const r = await fn(session);
    return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("api error:", err instanceof Error ? err.message : err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
