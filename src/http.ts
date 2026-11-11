// Request-body reading with a hard size cap, so an oversized body is refused before it is parsed.

/** The body as text, or null when it is larger than `max` bytes. Never buffers more than max + one chunk. */
export async function readLimitedText(req: Request, max = 2048): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** JSON object body within the cap, or null (too large, not JSON, or not an object). Empty body is `{}`. */
export async function readLimitedJson(req: Request, max = 2048): Promise<Record<string, unknown> | null> {
  const text = await readLimitedText(req, max);
  if (text === null) return null;
  if (text.trim() === "") return {};
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
