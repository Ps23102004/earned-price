// Pre-compiles sentences with the live local model into data/compiled/*.json (served cached when AI_LIVE=0).
// Run: pnpm tsx --env-file=.env scripts/build-compiled.mts            (quick picks + every rule case of the eval set)
//      pnpm tsx --env-file=.env scripts/build-compiled.mts "<sentence>"  (just that sentence)
// Refusals are never cached. Each model call can take about two minutes.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compileSentence, compiledDir, sentenceKey } from "../src/ai/compile";
import { sentenceProblem } from "../src/ai/compile-map";
import { QUICK_PICKS } from "../src/ai/quick-picks";

process.env.AI_LIVE = "1";
const args = process.argv.slice(2);
const cases = JSON.parse(readFileSync(new URL("../data/eval/compiler-cases.json", import.meta.url), "utf8")) as {
  sentence: string;
  expect: { kind: string };
}[];
const sentences = args.length > 0 ? args : [...QUICK_PICKS, ...cases.filter((c) => c.expect.kind === "rule").map((c) => c.sentence)];

mkdirSync(compiledDir(), { recursive: true });
let written = 0;
for (const sentence of [...new Set(sentences)]) {
  const file = path.join(compiledDir(), `${sentenceKey(sentence)}.json`);
  if (args.length === 0 && existsSync(file)) {
    console.log("skip (already cached):", sentence.slice(0, 60));
    continue;
  }
  const started = Date.now();
  const r = await compileSentence(sentence, { skipCache: true });
  const secs = Math.round((Date.now() - started) / 1000);
  if (r.status === "refused" && !sentenceProblem(sentence)) {
    // The model itself refused (not a code filter): record it so the hosted demo can show the refusal, labelled cached.
    writeFileSync(file, JSON.stringify({ sentence, refused: r.reasons, model: process.env.AI_MODEL, compiledAt: new Date().toISOString() }, null, 2) + "\n");
    written++;
    console.log(`refused in ${secs}s (cached):`, sentence.slice(0, 60), r.reasons.join("; "));
    continue;
  }
  if (r.status !== "compiled") {
    console.log(`${r.status} in ${secs}s, not cached:`, sentence.slice(0, 60), "reasons" in r ? r.reasons.join("; ") : r.reason);
    continue;
  }
  writeFileSync(
    file,
    JSON.stringify({ sentence, rule: r.rule, readback: r.readback, model: process.env.AI_MODEL, compiledAt: new Date().toISOString() }, null, 2) + "\n",
  );
  written++;
  console.log(`compiled in ${secs}s:`, sentence.slice(0, 60));
}
console.log(`done: ${written} file(s) written`);
