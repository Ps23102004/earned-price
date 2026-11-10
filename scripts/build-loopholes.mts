// Runs the live loophole hunt for LOOSE_RULE and every pre-compiled rule, and writes data/loopholes/*.json.
// Run: pnpm tsx --env-file=.env scripts/build-loopholes.mts
// Needs the local model (AI_LIVE=1) and GITHUB_SERVER_TOKEN. Only examples that passed the code check are written.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compiledDir } from "../src/ai/compile";
import { huntKey, huntLive, loopholesDir } from "../src/ai/hunt";
import { LOOSE_RULE } from "../src/rules/presets";
import type { Rule } from "../src/rules/types";
import { validateRule } from "../src/rules/validate";

process.env.AI_LIVE = "1";
const rules = new Map<string, Rule>([[huntKey(LOOSE_RULE), LOOSE_RULE]]);
try {
  for (const f of readdirSync(compiledDir()).filter((n) => n.endsWith(".json"))) {
    const v = validateRule(JSON.parse(readFileSync(path.join(compiledDir(), f), "utf8")).rule);
    if (v.ok) rules.set(huntKey(v.rule), v.rule);
  }
} catch {
  // no compiled directory yet: LOOSE_RULE only
}

mkdirSync(loopholesDir(), { recursive: true });
for (const [key, rule] of rules) {
  const started = Date.now();
  const hunt = await huntLive(rule);
  const examples = hunt.findings.reduce((n, f) => n + f.examples.length, 0);
  console.log(`${key.slice(0, 8)}: ${hunt.strategies.length} strategies, ${hunt.findings.length} findings, ${examples} verified examples, ${Math.round((Date.now() - started) / 1000)}s`);
  if (hunt.findings.length === 0) continue; // nothing verified: nothing to serve
  writeFileSync(path.join(loopholesDir(), `${key}.json`), JSON.stringify({ ...hunt, model: process.env.AI_MODEL }, null, 2) + "\n");
}
