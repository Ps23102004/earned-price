import { describe, expect, it, vi } from "vitest";
import { handleMcp } from "../src/agent/mcp";
import type { McpDeps } from "../src/agent/mcp";
import { loadSample, SAMPLE_NAMES } from "../src/facts/samples";
import { evaluate } from "../src/rules/evaluate";
import { DEFAULT_RULE, LOOSE_RULE } from "../src/rules/presets";
import { price } from "../src/rules/price";

const RID = "123e4567-e89b-42d3-a456-426614174000";
const live = vi.fn();
const deps = (over: Partial<McpDeps> = {}): McpDeps => ({
  appUrl: "https://shop.example",
  listCents: 4900,
  defaultRule: DEFAULT_RULE,
  loadRule: async (id) => (id === RID ? LOOSE_RULE : undefined),
  sampleNames: SAMPLE_NAMES,
  loadSample,
  liveFacts: live,
  ...over,
});
const call = async (name: string, args: unknown, d = deps()) => {
  const r = await handleMcp(d, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const res = (r as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { isError: !!res.isError, text: res.content[0].text };
};

describe("agent interface (MCP, read-only)", () => {
  it("initialize echoes a supported protocol version and declares tools only", async () => {
    const r = (await handleMcp(deps(), { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })) as { result: { protocolVersion: string; capabilities: object } };
    expect(r.result.protocolVersion).toBe("2025-03-26");
    expect(Object.keys(r.result.capabilities)).toEqual(["tools"]);
    const other = (await handleMcp(deps(), { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })) as { result: { protocolVersion: string } };
    expect(other.result.protocolVersion).toBe("2025-06-18");
  });
  it("lists exactly three read-only tools; notifications get no response; unknown methods error", async () => {
    const l = (await handleMcp(deps(), { jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string }[] } };
    expect(l.result.tools.map((t) => t.name)).toEqual(["get_rule", "preview_price", "get_checkout_link"]);
    expect(await handleMcp(deps(), { jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect(((await handleMcp(deps(), { jsonrpc: "2.0", id: 3, method: "orders/create" })) as { error: { code: number } }).error.code).toBe(-32601);
    expect(((await handleMcp(deps(), "nope")) as { error: { code: number } }).error.code).toBe(-32600);
  });
  it("preview_price equals what the quote code computes for the same rule and sample (cents), and says nothing was charged", async () => {
    const snap = loadSample("qualifies");
    const expected = price(LOOSE_RULE, evaluate(LOOSE_RULE, snap, snap.recordedAt ? new Date(snap.recordedAt) : undefined), 4900);
    const out = await call("preview_price", { ruleId: RID, sample: "qualifies" });
    expect(out.isError).toBe(false);
    const body = JSON.parse(out.text) as { earnedCents: number; discountCents: number; checkoutLink: string; note: string };
    expect(body.earnedCents).toBe(expected.earnedCents);
    expect(body.discountCents).toBe(expected.discountCents);
    expect(body.checkoutLink).toBe(`https://shop.example/shop/${RID}`);
    expect(body.note).toMatch(/No order was created/);
  });
  it("needs exactly one of sample or githubLogin, and rejects bad input without touching GitHub", async () => {
    live.mockReset();
    expect((await call("preview_price", {})).isError).toBe(true);
    expect((await call("preview_price", { sample: "qualifies", githubLogin: "octocat" })).isError).toBe(true);
    expect((await call("preview_price", { githubLogin: "not a login!" })).isError).toBe(true);
    expect((await call("preview_price", { sample: "nope" })).isError).toBe(true);
    expect((await call("preview_price", { sample: "qualifies", amount: 1 })).isError).toBe(true);
    expect((await call("preview_price", { ruleId: "not-a-uuid", sample: "qualifies" })).isError).toBe(true);
    expect((await call("preview_price", { ruleId: "00000000-0000-4000-8000-000000000000", sample: "qualifies" })).text).toBe("no such rule");
    expect(live).not.toHaveBeenCalled();
  });
  it("a live lookup uses the injected facts, and a spent budget is reported plainly", async () => {
    live.mockReset();
    live.mockResolvedValueOnce(loadSample("nearly"));
    const ok = await call("preview_price", { githubLogin: "octocat" });
    expect(ok.isError).toBe(false);
    expect(live).toHaveBeenCalledWith("octocat", DEFAULT_RULE);
    live.mockResolvedValueOnce("rate_limited");
    const limited = await call("preview_price", { githubLogin: "octocat" });
    expect(limited).toMatchObject({ isError: true });
    expect(limited.text).toMatch(/too many live lookups/);
    live.mockRejectedValueOnce(new Error("boom with secret-token-123"));
    const failed = await call("preview_price", { githubLogin: "octocat" });
    expect(failed.text).not.toMatch(/secret-token/);
  });
  it("get_rule and get_checkout_link work for the default and for a published rule", async () => {
    expect(JSON.parse((await call("get_rule", {})).text).readback).toContain("50%");
    expect(JSON.parse((await call("get_checkout_link", { ruleId: RID })).text).checkoutLink).toBe(`https://shop.example/shop/${RID}`);
    expect((await call("get_checkout_link", {})).isError).toBe(true);
    expect((await call("nope", {})).isError).toBe(true);
  });
  it("exposes no way to create an order or pay (the tool list has no write tool)", async () => {
    const l = (await handleMcp(deps(), { jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string }[] } };
    expect(l.result.tools.some((t) => /order|pay|capture|refund|claim|publish/i.test(t.name))).toBe(false);
  });
});
