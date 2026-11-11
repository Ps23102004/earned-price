import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MORE_PICKS, QUICK_PICKS } from "../src/ai/quick-picks";

describe("one-click merchant examples", () => {
  it("every example is an evaluated case, so the hosted demo can serve it cached", () => {
    const cases = JSON.parse(readFileSync("data/eval/compiler-cases.json", "utf8")) as { sentence: string }[];
    const known = new Set(cases.map((c) => c.sentence));
    for (const p of [...QUICK_PICKS.slice(0, 2), ...MORE_PICKS.map((m) => m.text)]) expect(known.has(p)).toBe(true);
  });
});
