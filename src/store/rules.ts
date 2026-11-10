// Preset rules as database rows, so every order can point at the exact rule it was priced under.

import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "../facts/snapshot";
import { PRESETS } from "../rules/presets";
import { readback } from "../rules/readback";
import type { Rule } from "../rules/types";
import { validateRule } from "../rules/validate";
import { query } from "./db";

type RuleRef = { id: string; version: number };

export async function ensureRule(name: "loose" | "default"): Promise<RuleRef> {
  const sentence = `preset:${name}`;
  const find = async () => (await query<RuleRef>(`select id, version from rules where sentence = $1`, [sentence])).rows[0];
  const found = await find();
  if (found) return found;
  const rule = PRESETS[name];
  const ins = await query<RuleRef>(
    `insert into rules (id, version, sentence, compiled, readback) values ($1, 1, $2, $3::jsonb, $4)
     on conflict (sentence) do nothing returning id, version`,
    [randomUUID(), sentence, JSON.stringify(rule), readback(rule)],
  );
  const row = ins.rows[0] ?? (await find()); // another request inserted it first
  if (!row) throw new Error("ensureRule: rule row missing");
  return row;
}

/**
 * Merchant rules as rows. The sentence column is unique, so it carries a short hash of the rule itself:
 * the same sentence compiled to another rule is a new row, and an existing row is never changed.
 */
export async function saveRule(sentence: string, rule: Rule): Promise<RuleRef> {
  const key = `${sentence} #${createHash("sha256").update(canonicalJson(rule)).digest("hex").slice(0, 12)}`;
  const find = async () => (await query<RuleRef>(`select id, version from rules where sentence = $1`, [key])).rows[0];
  const found = await find();
  if (found) return found;
  const ins = await query<RuleRef>(
    `insert into rules (id, version, sentence, compiled, readback) values ($1, 1, $2, $3::jsonb, $4)
     on conflict (sentence) do nothing returning id, version`,
    [randomUUID(), key, JSON.stringify(rule), readback(rule)],
  );
  const row = ins.rows[0] ?? (await find());
  if (!row) throw new Error("saveRule: rule row missing");
  return row;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stored rule, validated again on the way out. Undefined for an unknown id or a row that no longer validates. */
export async function loadRuleRow(id: unknown): Promise<(RuleRef & { rule: Rule }) | undefined> {
  if (typeof id !== "string" || !UUID.test(id)) return undefined;
  const r = await query<RuleRef & { compiled: unknown }>(`select id, version, compiled from rules where id = $1`, [id]);
  const row = r.rows[0];
  if (!row) return undefined;
  const v = validateRule(row.compiled);
  return v.ok ? { id: row.id, version: row.version, rule: v.rule } : undefined;
}
