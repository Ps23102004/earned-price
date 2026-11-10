import { guarded } from "@/session";

export function POST(req: Request) {
  return guarded(async (session) => {
    delete session.github;
    delete session.sample;
    await session.save();
    return { status: 200, body: { ok: true } };
  }, req);
}
