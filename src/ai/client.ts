// Chat client for the merchant's own model: any OpenAI-compatible server (AI_BASE_URL, AI_MODEL).
// Plain chat only: the server's JSON-schema response mode is not used. Errors never echo the request.
// Reasoning models can think for minutes before answering a short question, so reasoning effort defaults to
// "none" (AI_REASONING_EFFORT overrides it; set it to an empty string to send no such field).

export type ChatMessage = { role: "system" | "user"; content: string };

export const aiLive = (): boolean => process.env.AI_LIVE === "1";

export async function chat(messages: ChatMessage[], opts: { timeoutMs?: number } = {}): Promise<string> {
  const base = process.env.AI_BASE_URL;
  const model = process.env.AI_MODEL;
  if (!base || !model) throw new Error("model is not configured");
  const effort = process.env.AI_REASONING_EFFORT ?? "none";
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      // Optional: a hosted OpenAI-compatible service needs a key. It is sent only as this header and never logged or echoed.
      headers: { "Content-Type": "application/json", ...(process.env.AI_API_KEY ? { Authorization: `Bearer ${process.env.AI_API_KEY}` } : {}) },
      body: JSON.stringify({ model, messages, temperature: 0, stream: false, ...(effort ? { reasoning_effort: effort } : {}) }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
    });
  } catch {
    throw new Error("model request failed or timed out");
  }
  if (!res.ok) throw new Error(`model responded with HTTP ${res.status}`);
  const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") throw new Error("model returned no text");
  return content;
}
