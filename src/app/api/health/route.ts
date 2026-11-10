// Liveness probe for the host and the keep-alive pinger. Never touches the database.
export function GET() {
  return Response.json({ ok: true });
}
