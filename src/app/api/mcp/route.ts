import { handleMcp } from "@/agent/mcp";
import type { McpDeps } from "@/agent/mcp";
import { fetchGithubFacts } from "@/facts/github";
import { SAMPLE_NAMES, loadSample } from "@/facts/samples";
import { readLimitedText } from "@/http";
import { allow, clientIp } from "@/ratelimit";
import { DEFAULT_RULE } from "@/rules/presets";
import { loadRuleRow } from "@/store/rules";

// Public, read-only agent interface (MCP over HTTP). No cookies, no session, no order, no PayPal call.
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  if (!allow(`mcp:${ip}`, 300, 3_600_000)) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "too many requests" } }, { status: 429, headers: JSON_HEADERS });
  const raw = await readLimitedText(req, 8_192);
  let msg: unknown;
  try {
    msg = raw === null ? undefined : JSON.parse(raw);
  } catch {
    msg = undefined;
  }
  if (msg === undefined) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error or body too large" } }, { status: 400, headers: JSON_HEADERS });

  const deps: McpDeps = {
    appUrl: (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/+$/, ""),
    listCents: 4900,
    defaultRule: DEFAULT_RULE,
    loadRule: async (id) => (await loadRuleRow(id))?.rule,
    sampleNames: SAMPLE_NAMES,
    loadSample,
    liveFacts: async (login, rule) => {
      // Live lookups spend the server's GitHub budget: tight per-address and shared caps.
      if (!allow(`mcp-live:${ip}`, 10, 3_600_000) || !allow("mcp-live:global", 100, 3_600_000)) return "rate_limited";
      const token = process.env.GITHUB_SERVER_TOKEN;
      if (!token) throw new Error("GITHUB_SERVER_TOKEN is not set");
      return (await fetchGithubFacts(login, rule, { token })).snapshot;
    },
  };

  const batch = Array.isArray(msg);
  const all: unknown[] = batch ? (msg as unknown[]) : [msg];
  if (batch && all.length === 0) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "empty batch" } }, { status: 400, headers: JSON_HEADERS });
  // At most 10 messages per batch are run; the rest get an explicit error instead of being dropped silently.
  const MAX_BATCH = 10;
  const idOf = (m: unknown) => (typeof m === "object" && m !== null && "id" in m ? (m as { id: unknown }).id : undefined);
  const run = all.slice(0, MAX_BATCH).map((m) => handleMcp(deps, m).catch(() => ({ jsonrpc: "2.0" as const, id: idOf(m) ?? null, error: { code: -32603, message: "internal error" } })));
  const over = all.slice(MAX_BATCH).filter((m) => idOf(m) !== undefined).map((m) => ({ jsonrpc: "2.0" as const, id: idOf(m), error: { code: -32600, message: `batch limit is ${MAX_BATCH} messages` } }));
  const out = [...(await Promise.all(run)), ...over].filter((r) => r !== undefined);
  if (out.length === 0) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  return Response.json(batch ? out : out[0], { headers: JSON_HEADERS });
}

export function GET() {
  return Response.json({ error: "This is an MCP endpoint: POST JSON-RPC to it. See /agent." }, { status: 405, headers: { ...JSON_HEADERS, Allow: "POST" } });
}
