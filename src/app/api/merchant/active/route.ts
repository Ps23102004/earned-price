import { getSession } from "@/session";
import { activeRuleView } from "@/store/merchant";

// Read-only: this browser's published rule, for the merchant page. No state change, so no Origin check.
export async function GET() {
  const view = await activeRuleView(await getSession());
  return Response.json(view ? { published: { ruleId: view.ruleId, readback: view.readback } } : { published: null }, {
    headers: { "Cache-Control": "no-store" },
  });
}
