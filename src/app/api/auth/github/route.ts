import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { safeReturnTo, signState } from "@/auth/state";
import { getSession } from "@/session";

export async function GET(req: Request) {
  const session = await getSession(); // first: this handler must always be request-time, never prerendered
  const clientId = process.env.GITHUB_CLIENT_ID;
  const appUrl = process.env.APP_URL;
  if (!clientId || !appUrl) return Response.json({ error: "GitHub sign-in is not configured" }, { status: 503 });

  const nonce = randomBytes(16).toString("hex");
  const returnTo = safeReturnTo(new URL(req.url).searchParams.get("returnTo"));
  const state = signState({ nonce, sid: session.sid, returnTo }, process.env.SESSION_SECRET as string);
  (await cookies()).set("ep_oauth", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  // No `scope` parameter: the token can read only what is already public.
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: new URL("/api/auth/github/callback", appUrl).toString(),
    state,
  }).toString();
  return new Response(null, { status: 302, headers: { Location: authorize.toString() } });
}
