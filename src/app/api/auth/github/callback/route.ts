import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { safeReturnTo, verifyState } from "@/auth/state";
import { getSession } from "@/session";

const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } });
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Exchange the code, read the user once, and drop the token: it is never stored or logged. */
async function githubUser(code: string): Promise<{ id: number; login: string; avatarUrl: string }> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "earned-price-demo" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL("/api/auth/github/callback", process.env.APP_URL).toString(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = (await tokenRes.json().catch(() => null))?.access_token;
  if (!tokenRes.ok || typeof token !== "string") throw new Error("token exchange failed");
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "earned-price-demo" },
    signal: AbortSignal.timeout(10_000),
  });
  const u = await userRes.json().catch(() => null);
  if (!userRes.ok || !Number.isInteger(u?.id) || typeof u?.login !== "string") throw new Error("user lookup failed");
  const avatar = typeof u.avatar_url === "string" && u.avatar_url.startsWith("https://") ? u.avatar_url.slice(0, 300) : "";
  return { id: u.id, login: u.login, avatarUrl: avatar };
}

export async function GET(req: Request) {
  const session = await getSession();
  const jar = await cookies();
  const nonce = jar.get("ep_oauth")?.value;
  jar.delete("ep_oauth"); // single use, whatever happens next
  try {
    const q = new URL(req.url).searchParams;
    if (q.get("error") === "access_denied") return redirect("/?signin=cancelled");
    const code = q.get("code");
    const state = verifyState(q.get("state") ?? "", process.env.SESSION_SECRET as string);
    if (!code || !state || !nonce || state.sid !== session.sid || !same(state.nonce, nonce)) return redirect("/?signin=failed");
    session.github = await githubUser(code);
    delete session.sample;
    await session.save();
    return redirect(safeReturnTo(state.returnTo));
  } catch (err) {
    console.error("github sign-in failed:", err instanceof Error ? err.message : "unknown");
    return redirect("/?signin=failed");
  }
}
