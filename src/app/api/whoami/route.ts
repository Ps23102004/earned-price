// TEMPORARY diagnostic: shows the caller's own forwarding headers so the proxy chain can be read once. Removed right after.
export function GET(req: Request) {
  const h = req.headers;
  return Response.json({ xff: h.get("x-forwarded-for"), cf: h.get("cf-connecting-ip"), trueClient: h.get("true-client-ip"), forwardedProto: h.get("x-forwarded-proto") }, { headers: { "Cache-Control": "no-store" } });
}
