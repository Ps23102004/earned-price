// A read-only agent interface (Model Context Protocol, JSON-RPC over HTTP) to the same rules and prices a buyer sees.
// It never creates an order, never touches PayPal and never writes anything. An agent can read a merchant's rule and
// ask "what would this buyer pay?"; paying still needs the buyer's own sign-in and PayPal approval. Pure apart from
// the injected dependencies, so it is tested without a network or a database.

import type { SampleName } from "../facts/samples";
import type { GithubSnapshot } from "../facts/types";
import { evaluate } from "../rules/evaluate";
import { explain } from "../rules/explain";
import { price } from "../rules/price";
import { readback } from "../rules/readback";
import type { Rule } from "../rules/types";

export type McpDeps = {
  appUrl: string;
  listCents: number;
  defaultRule: Rule;
  loadRule: (id: string) => Promise<Rule | undefined>;
  sampleNames: readonly SampleName[];
  loadSample: (name: SampleName) => GithubSnapshot;
  /** Live public facts for a login; returns undefined when the budget for live lookups is spent. */
  liveFacts: (login: string, rule: Rule) => Promise<GithubSnapshot | "rate_limited">;
};

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOOLS = [
  {
    name: "get_rule",
    description: "Read a merchant's earned-price rule in plain English and as validated JSON. Without ruleId it returns the shop's default rule. Read-only.",
    inputSchema: { type: "object", properties: { ruleId: { type: "string", description: "Rule id from a checkout link (optional)" } }, additionalProperties: false },
  },
  {
    name: "preview_price",
    description:
      "What would this buyer pay for the $49.00 licence under the rule? Give exactly one of: sample (a recorded anonymised profile) or githubLogin (a public GitHub login; live public facts). Computed by deterministic code; creates no order and charges nothing.",
    inputSchema: {
      type: "object",
      properties: {
        ruleId: { type: "string", description: "Rule id from a checkout link (optional; default rule if omitted)" },
        sample: { type: "string", enum: ["qualifies", "nearly", "loophole"] },
        githubLogin: { type: "string", description: "Public GitHub login" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_checkout_link",
    description: "The checkout link for a rule. The buyer opens it, signs in with GitHub (no permissions) and pays with PayPal themselves; an agent cannot pay.",
    inputSchema: { type: "object", properties: { ruleId: { type: "string" } }, required: ["ruleId"], additionalProperties: false },
  },
] as const;

type Json = Record<string, unknown>;
type RpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type RpcResponse = { jsonrpc: "2.0"; id: unknown; result?: unknown; error?: { code: number; message: string } };

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
const ok = (id: unknown, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
const err = (id: unknown, code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

async function pickRule(d: McpDeps, ruleId: unknown): Promise<{ rule: Rule; id?: string } | string> {
  if (ruleId === undefined) return { rule: d.defaultRule };
  if (typeof ruleId !== "string" || !UUID.test(ruleId)) return "ruleId must be a rule id from a checkout link";
  const rule = await d.loadRule(ruleId);
  return rule ? { rule, id: ruleId } : "no such rule";
}

async function callTool(d: McpDeps, name: unknown, args: unknown) {
  const a: Json = isObj(args) ? args : {};
  const unknownKeys = (allowed: string[]) => Object.keys(a).filter((k) => !allowed.includes(k));

  if (name === "get_rule") {
    if (unknownKeys(["ruleId"]).length > 0) return text("unexpected argument", true);
    const p = await pickRule(d, a.ruleId);
    if (typeof p === "string") return text(p, true);
    return text(JSON.stringify({ readback: readback(p.rule), rule: p.rule, ...(p.id ? { checkoutLink: `${d.appUrl}/shop/${p.id}` } : {}) }, null, 2));
  }

  if (name === "get_checkout_link") {
    if (unknownKeys(["ruleId"]).length > 0) return text("unexpected argument", true);
    const p = await pickRule(d, a.ruleId === undefined ? "" : a.ruleId);
    if (typeof p === "string") return text(p, true);
    return text(JSON.stringify({ checkoutLink: `${d.appUrl}/shop/${p.id}`, note: "The buyer signs in with GitHub and pays with PayPal themselves." }));
  }

  if (name === "preview_price") {
    if (unknownKeys(["ruleId", "sample", "githubLogin"]).length > 0) return text("unexpected argument", true);
    const p = await pickRule(d, a.ruleId);
    if (typeof p === "string") return text(p, true);
    const hasSample = a.sample !== undefined;
    const hasLogin = a.githubLogin !== undefined;
    if (hasSample === hasLogin) return text("give exactly one of sample or githubLogin", true);

    let snapshot: GithubSnapshot;
    let who: string;
    if (hasSample) {
      if (typeof a.sample !== "string" || !(d.sampleNames as readonly string[]).includes(a.sample)) return text(`sample must be one of: ${d.sampleNames.join(", ")}`, true);
      snapshot = d.loadSample(a.sample as SampleName);
      who = `recorded sample "${a.sample}" (${snapshot.recordedAt ?? "recorded"})`;
    } else {
      if (typeof a.githubLogin !== "string" || !LOGIN.test(a.githubLogin)) return text("githubLogin is not a valid GitHub login", true);
      let live: GithubSnapshot | "rate_limited";
      try {
        live = await d.liveFacts(a.githubLogin, p.rule);
      } catch {
        return text("GitHub could not be read right now; try a sample or try again later", true);
      }
      if (live === "rate_limited") return text("too many live lookups; try a sample or try again later", true);
      snapshot = live;
      who = `public facts of GitHub login ${a.githubLogin}, fetched ${snapshot.fetchedAt}`;
    }
    const result = evaluate(p.rule, snapshot, snapshot.recordedAt ? new Date(snapshot.recordedAt) : undefined);
    const priced = price(p.rule, result, d.listCents);
    const view = explain(p.rule, result, priced);
    return text(
      JSON.stringify(
        {
          basedOn: who,
          listCents: priced.listCents ?? d.listCents,
          earnedCents: priced.earnedCents,
          discountCents: priced.discountCents,
          appliedTier: view.appliedTierId ?? null,
          tiers: view.rows.map((r) => ({ label: r.label, percent: r.discountPercent, status: r.status, conditions: r.conditions.map((c) => ({ text: c.text, actual: c.actual, needed: c.threshold, met: c.passed })) })),
          ...(p.id ? { checkoutLink: `${d.appUrl}/shop/${p.id}` } : {}),
          note: "A preview computed by code. No order was created and nothing was charged. Paying needs the buyer's own GitHub sign-in and PayPal approval.",
        },
        null,
        2,
      ),
    );
  }
  return text("unknown tool", true);
}

/** One JSON-RPC message. Returns undefined for notifications (no response body). */
export async function handleMcp(d: McpDeps, msg: unknown): Promise<RpcResponse | undefined> {
  if (!isObj(msg) || msg.jsonrpc !== "2.0" || typeof (msg as RpcRequest).method !== "string") return err(isObj(msg) ? msg.id ?? null : null, -32600, "invalid request");
  const { id, params } = msg as RpcRequest;
  const method = (msg as RpcRequest).method as string;
  const isNotification = id === undefined;
  const p: Json = isObj(params) ? params : {};
  switch (method) {
    case "initialize": {
      const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      return ok(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "earned-price", version: "1.0.0" },
        instructions:
          "Earned Price prices a $49.00 licence by public GitHub facts, read live when a price is previewed. Read a merchant's rule, preview what a buyer would pay, and fetch the checkout link. This server is read-only: it cannot create orders or pay.",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call":
      return ok(id, await callTool(d, p.name, p.arguments));
    default:
      if (isNotification || method.startsWith("notifications/")) return undefined;
      return err(id, -32601, "method not found");
  }
}
