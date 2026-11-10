import { guarded } from "@/session";
import { listForSession } from "@/store/orders";

export function GET() {
  return guarded((session) => listForSession(session.sid));
}
