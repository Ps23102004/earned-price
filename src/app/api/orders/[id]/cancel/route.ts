import { guarded } from "@/session";
import { cancel } from "@/store/orders";

export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async (session) => cancel((await params).id, session.sid), req);
}
