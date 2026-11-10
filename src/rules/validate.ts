// Validation of untrusted (AI-produced) rules, and the "not looser" check. Pure.

import {
  FIELDS,
  FIELD_MAX,
  PR_FIELDS,
  type Condition,
  type Field,
  type PrFilters,
  type Rule,
  type Tier,
  type ValidationResult,
} from "./types";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isIntIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function unknownKeys(o: Obj, allowed: string[], where: string, errors: string[]) {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) errors.push(`${where}: unknown key "${k}"`);
  }
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00.000Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s && s >= "2008-01-01";
}

function checkPr(v: unknown, where: string, errors: string[]): PrFilters | undefined {
  if (!isObj(v)) {
    errors.push(`${where}: pr must be an object`);
    return undefined;
  }
  const keys = ["minRepoStars", "minLinesChanged", "excludeOwnRepos", "excludeForks", "mergedSince", "minAccountAgeDaysAtMerge"];
  unknownKeys(v, keys, where, errors);
  const out: PrFilters = {};
  const n = (k: "minRepoStars" | "minLinesChanged" | "minAccountAgeDaysAtMerge", max: number) => {
    if (v[k] === undefined) return;
    if (isIntIn(v[k], 1, max)) out[k] = v[k];
    else errors.push(`${where}: ${k} must be an integer from 1 to ${max.toLocaleString("en-US")}`);
  };
  n("minRepoStars", 10_000_000);
  n("minLinesChanged", 1_000_000);
  n("minAccountAgeDaysAtMerge", 15_000);
  for (const k of ["excludeOwnRepos", "excludeForks"] as const) {
    if (v[k] === undefined) continue;
    if (typeof v[k] === "boolean") out[k] = v[k];
    else errors.push(`${where}: ${k} must be true or false`);
  }
  if (v.mergedSince !== undefined) {
    const s = v.mergedSince;
    if (s === "year_start" || (typeof s === "string" && isRealDate(s))) out.mergedSince = s;
    else errors.push(`${where}: mergedSince must be "year_start" or a real YYYY-MM-DD date on or after 2008-01-01`);
  }
  return out;
}

function checkCondition(v: unknown, where: string, errors: string[]): Condition | undefined {
  if (!isObj(v)) {
    errors.push(`${where}: condition must be an object`);
    return undefined;
  }
  unknownKeys(v, ["field", "op", "value", "pr"], where, errors);
  const field = v.field;
  const okField = typeof field === "string" && (FIELDS as readonly string[]).includes(field);
  if (!okField) errors.push(`${where}: field must be one of ${FIELDS.join(", ")}`);
  if (v.op !== "gte") errors.push(`${where}: op must be "gte"`);
  if (okField) {
    const max = FIELD_MAX[field as Field];
    if (!isIntIn(v.value, 1, max)) errors.push(`${where}: value must be an integer from 1 to ${max.toLocaleString("en-US")}`);
  } else if (!isIntIn(v.value, 1, Number.MAX_SAFE_INTEGER)) {
    errors.push(`${where}: value must be a positive integer`);
  }
  let pr: PrFilters | undefined;
  if (v.pr !== undefined) {
    if (okField && !PR_FIELDS.includes(field as Field)) errors.push(`${where}: pr filters are not allowed on ${field}`);
    else pr = checkPr(v.pr, `${where}.pr`, errors);
  }
  if (!okField || v.op !== "gte" || typeof v.value !== "number") return undefined;
  return { field: field as Field, op: "gte", value: v.value, ...(pr ? { pr } : {}) };
}

function checkTier(v: unknown, where: string, errors: string[]): Tier | undefined {
  if (!isObj(v)) {
    errors.push(`${where}: tier must be an object`);
    return undefined;
  }
  unknownKeys(v, ["id", "label", "discountPercent", "conditions"], where, errors);
  if (typeof v.id !== "string" || !/^[a-z0-9_-]{1,32}$/.test(v.id)) {
    errors.push(`${where}: id must be 1-32 characters of lowercase letters, digits, "_" or "-"`);
  }
  // Labels are echoed into the code-generated read-back, so they must not carry punctuation or control characters.
  if (typeof v.label !== "string" || !/^[\p{L}\p{N} _%+&'-]{1,80}$/u.test(v.label)) {
    errors.push(`${where}: label must be 1 to 80 letters, digits, spaces or _ % + & ' -`);
  }
  if (!isIntIn(v.discountPercent, 1, 90)) errors.push(`${where}: discountPercent must be an integer from 1 to 90`);
  const conditions: Condition[] = [];
  if (!Array.isArray(v.conditions) || v.conditions.length < 1 || v.conditions.length > 3) {
    errors.push(`${where}: conditions must be a list of 1 to 3 conditions`);
  } else {
    for (let i = 0; i < v.conditions.length; i++) {
      const cond = checkCondition(v.conditions[i], `${where}.conditions[${i}]`, errors);
      if (cond) conditions.push(cond);
    }
  }
  return {
    id: v.id as string,
    label: v.label as string,
    discountPercent: v.discountPercent as number,
    conditions,
  };
}

export function validateRule(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["rule must be an object"] };
  unknownKeys(input, ["version", "tiers"], "rule", errors);
  if (input.version !== 1) errors.push("rule: version must be 1");
  const tiers: Tier[] = [];
  if (!Array.isArray(input.tiers) || input.tiers.length < 1 || input.tiers.length > 3) {
    errors.push("rule: tiers must be a list of 1 to 3 tiers");
  } else {
    const seen = new Set<string>();
    for (let i = 0; i < input.tiers.length; i++) {
      const tier = checkTier(input.tiers[i], `tiers[${i}]`, errors);
      if (!tier) continue;
      if (seen.has(tier.id)) errors.push(`tiers[${i}]: duplicate tier id "${tier.id}"`);
      seen.add(tier.id);
      tiers.push(tier);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rule: { version: 1, tiers } };
}

function prAtLeastAsStrict(o: PrFilters | undefined, n: PrFilters | undefined): boolean {
  if (!o) return true;
  const nn = n ?? {};
  for (const k of ["minRepoStars", "minLinesChanged", "minAccountAgeDaysAtMerge"] as const) {
    if (o[k] !== undefined && (nn[k] === undefined || nn[k] < o[k])) return false;
  }
  for (const k of ["excludeOwnRepos", "excludeForks"] as const) {
    if (o[k] === true && nn[k] !== true) return false;
  }
  return o.mergedSince === undefined || nn.mergedSince === o.mergedSince;
}

export function isNotLooser(oldRule: Rule, newRule: Rule): boolean {
  if (oldRule.tiers.length !== newRule.tiers.length) return false;
  return oldRule.tiers.every((ot, i) => {
    const nt = newRule.tiers[i];
    if (nt.id !== ot.id || nt.discountPercent !== ot.discountPercent) return false;
    if (nt.conditions.length < ot.conditions.length) return false;
    return ot.conditions.every((oc, j) => {
      const nc = nt.conditions[j];
      return nc.field === oc.field && nc.value >= oc.value && prAtLeastAsStrict(oc.pr, nc.pr);
    });
  });
}
