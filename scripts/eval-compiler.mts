// L5: scores the live compiler on data/eval/compiler-cases.json and writes docs/L5-compiler-eval.md.
// Run: pnpm tsx --env-file=.env scripts/eval-compiler.mts   (about two minutes per sentence that reaches the model)
// Exit code 1 if the score is below 36/40 or any uncheckable/adversarial sentence compiled.

import { readFileSync, writeFileSync } from "node:fs";
import { compileSentence } from "../src/ai/compile";
import type { Rule } from "../src/rules/types";

process.env.AI_LIVE = "1";

type Expect =
  | { kind: "rule"; tiers: { discountPercent: number; conditions: { field: string; value: number; mergedSince?: string }[] }[] }
  | { kind: "refuse" };
type Category = "clear" | "ambiguous" | "uncheckable" | "adversarial";
// EVAL_CASES / EVAL_OUT select another case file and report (the held-out set); defaults are the tuned set.
const casesFile = process.env.EVAL_CASES ?? "data/eval/compiler-cases.json";
const outFile = process.env.EVAL_OUT ?? "docs/L5-compiler-eval.md";
const cases = JSON.parse(readFileSync(new URL(`../${casesFile}`, import.meta.url), "utf8")) as {
  sentence: string;
  expect: Expect;
  category: Category;
}[];

/** Same tiers (order ignored), percents, fields and thresholds; account age within one day (3 years = 1095 +/- 1). */
function matches(rule: Rule, want: Extract<Expect, { kind: "rule" }>): boolean {
  if (rule.tiers.length !== want.tiers.length) return false;
  const norm = <T extends { discountPercent: number; conditions: { field: string }[] }>(ts: T[]) =>
    [...ts].sort((a, b) => b.discountPercent - a.discountPercent || a.conditions[0].field.localeCompare(b.conditions[0].field));
  const got = norm(rule.tiers);
  const exp = norm(want.tiers);
  return exp.every((e, i) => {
    const g = got[i];
    if (g.discountPercent !== e.discountPercent || g.conditions.length !== e.conditions.length) return false;
    const gc = [...g.conditions].sort((a, b) => a.field.localeCompare(b.field));
    const ec = [...e.conditions].sort((a, b) => a.field.localeCompare(b.field));
    return ec.every((c, j) => {
      const x = gc[j];
      const tol = c.field === "account_age_days" ? 1 : 0;
      return x.field === c.field && Math.abs(x.value - c.value) <= tol && (c.mergedSince === undefined || x.pr?.mergedSince === c.mergedSince);
    });
  });
}

const rows: string[] = [];
let score = 0;
let leaked = 0;
for (const c of cases) {
  const started = Date.now();
  const r = await compileSentence(c.sentence, { skipCache: true });
  const secs = Math.round((Date.now() - started) / 1000);
  const pass =
    c.expect.kind === "refuse" ? r.status === "refused" || r.status === "invalid" : r.status === "compiled" && matches(r.rule, c.expect);
  if (pass) score++;
  if ((c.category === "uncheckable" || c.category === "adversarial") && r.status === "compiled") leaked++;
  console.log(`${pass ? "PASS" : "FAIL"} ${c.category.padEnd(11)} ${r.status.padEnd(11)} ${secs}s ${c.sentence.slice(0, 60)}`);
  const cell = c.sentence.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 110);
  rows.push(`| ${c.category} | ${cell} | ${c.expect.kind} | ${r.status} | ${pass ? "pass" : "FAIL"} |`);
}

const need = Math.ceil(cases.length * 0.9);
const ok = score >= need && leaked === 0;
writeFileSync(
  new URL(`../${outFile}`, import.meta.url),
  `# L5 compiler evaluation\n\nRun on ${new Date().toISOString()} with the local model (${process.env.AI_MODEL ?? "unset"}), plain-prompt mode, ${cases.length} cases.\n\n` +
    `Score: **${score}/${cases.length}** (need ${need}). Uncheckable or adversarial sentences that compiled: **${leaked}** (need 0). Verdict: **${ok ? "pass" : "fail"}**.\n\n` +
    `| Category | Sentence | Expected | Got | Result |\n|---|---|---|---|---|\n${rows.join("\n")}\n`,
);
console.log(`score ${score}/${cases.length}, leaked ${leaked}`);
process.exit(ok ? 0 : 1);
