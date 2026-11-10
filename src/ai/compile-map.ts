// Turns untrusted model output into a validated Rule. Pure. The model proposes; validateRule decides.

import { PR_FIELDS } from "../rules/types";
import type { Field, Rule } from "../rules/types";
import { validateRule } from "../rules/validate";

export type ModelRule = {
  refuse: boolean;
  unsupported: string[];
  tiers: {
    label: string;
    discountPercent: number;
    conditions: {
      field: string;
      value: number;
      mergedSince?: string;
      minRepoStars?: number;
      minLinesChanged?: number;
      excludeOwnRepos?: boolean;
      excludeForks?: boolean;
      minAccountAgeDaysAtMerge?: number;
    }[];
  }[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** First top-level JSON object in the text, skipping code fences and prose. Throws when there is none. */
export function parseModelJson(text: string): unknown {
  const s = typeof text === "string" ? text : "";
  for (let start = s.indexOf("{"); start !== -1; start = s.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          break; // not JSON after all: try the next brace
        }
      }
    }
  }
  throw new Error("no JSON object in model output");
}

/** Keep only what validateRule accepts in a label. */
export function sanitizeLabel(s: unknown, fallback: string): string {
  if (typeof s !== "string") return fallback;
  const t = s.replace(/\s+/gu, " ").replace(/[^\p{L}\p{N} _%+&'-]/gu, "").replace(/ +/g, " ").trim();
  const out = Array.from(t).slice(0, 80).join("").trim();
  return out === "" ? fallback : out;
}

const TOP_KEYS = ["refuse", "unsupported", "tiers"];
const TIER_KEYS = ["label", "discountPercent", "conditions"];
const PR_KEYS = ["mergedSince", "minRepoStars", "minLinesChanged", "excludeOwnRepos", "excludeForks", "minAccountAgeDaysAtMerge"];
const COND_KEYS = ["field", "value", ...PR_KEYS];

const fail = (...reasons: string[]) => ({ ok: false as const, reasons });
const keyText = (k: string) => JSON.stringify(k.slice(0, 40));

function convert(m: unknown): { ok: true; rule: Rule } | { ok: false; reasons: string[] } {
  if (!isObj(m)) return fail("the model output is not an object");
  if (m.refuse === true) {
    const items = Array.isArray(m.unsupported) ? m.unsupported.filter((x): x is string => typeof x === "string") : [];
    return fail("refused: " + items.map((x) => x.slice(0, 200)).join(", "));
  }
  const errors: string[] = [];
  for (const k of Object.keys(m)) if (!TOP_KEYS.includes(k)) errors.push(`unknown key ${keyText(k)}`);
  if (m.refuse !== undefined && m.refuse !== false) errors.push("refuse must be true or false");
  if (!Array.isArray(m.tiers)) return fail(...errors, "tiers must be a list");

  const tiers = m.tiers.map((t: unknown, i: number) => {
    if (!isObj(t)) {
      errors.push(`tier ${i + 1} is not an object`);
      return t;
    }
    for (const k of Object.keys(t)) if (!TIER_KEYS.includes(k)) errors.push(`tier ${i + 1}: unknown key ${keyText(k)}`);
    const conditions = Array.isArray(t.conditions)
      ? t.conditions.map((c: unknown, j: number) => {
          if (!isObj(c)) {
            errors.push(`tier ${i + 1} condition ${j + 1} is not an object`);
            return c;
          }
          for (const k of Object.keys(c)) if (!COND_KEYS.includes(k)) errors.push(`tier ${i + 1} condition ${j + 1}: unknown key ${keyText(k)}`);
          const filterKeys = PR_KEYS.filter((k) => k in c);
          const isPrField = typeof c.field === "string" && PR_FIELDS.includes(c.field as Field);
          if (filterKeys.length > 0 && !isPrField) {
            errors.push(`tier ${i + 1} condition ${j + 1}: filters are only allowed on pull-request fields`);
          }
          const pr: Obj = {};
          for (const k of filterKeys) pr[k] = c[k];
          return { field: c.field, op: "gte", value: c.value, ...(filterKeys.length > 0 && isPrField ? { pr } : {}) };
        })
      : t.conditions; // not a list: validateRule reports it
    return { id: `t${i + 1}`, label: sanitizeLabel(t.label, `Tier ${i + 1}`), discountPercent: t.discountPercent, conditions };
  });
  if (errors.length > 0) return fail(...errors);

  const v = validateRule({ version: 1, tiers });
  return v.ok ? { ok: true, rule: v.rule } : fail(...v.errors);
}

/** Never throws. */
export function toRule(m: unknown): { ok: true; rule: Rule } | { ok: false; reasons: string[] } {
  try {
    return convert(m);
  } catch {
    return fail("the model output could not be read as a rule");
  }
}

const INJECTION: RegExp[] = [
  /ignore\s+(?:(?:all|any|the|these|those|of)\s+)*(?:previous|prior|above)/i,
  /system\s+prompt/i,
  /you\s+are\s+(?:now\s+)?/i,
  /disregard/i,
  /override/i,
  /jailbreak/i,
  /\bjson\b/i,
  /"tiers"/i,
  /discountPercent/i,
  /<\/?[a-z]+>/i,
  /\{\s*"/,
];

/** True when the sentence reads as instructions to a model rather than a discount policy. */
export function looksLikeInjection(sentence: string): boolean {
  return INJECTION.some((re) => re.test(sentence));
}

/** Code-side limits on the merchant's sentence: 1 to 500 characters after trimming, no instructions. */
export function sentenceProblem(sentence: unknown): string | undefined {
  if (typeof sentence !== "string") return "the sentence must be text";
  const t = sentence.trim();
  if (t.length < 1 || t.length > 500) return "the sentence must be 1 to 500 characters";
  if (looksLikeInjection(t)) return "the sentence contains instructions, not a discount policy";
  return undefined;
}
