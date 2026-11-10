// Preset rules as database rows, so every order can point at the exact rule it was priced under.

import { randomUUID } from "node:crypto";
import { PRESETS } from "../rules/presets";
import { readback } from "../rules/readback";
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
