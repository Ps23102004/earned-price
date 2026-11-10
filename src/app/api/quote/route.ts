import { guarded } from "@/session";
import { createGuestQuote } from "@/store/orders";

export function POST(req: Request) {
  return guarded(async (session) => {
    const r = await createGuestQuote(session.sid);
    session.hasOrders = true;
    await session.save();
    return r;
  }, req);
}
