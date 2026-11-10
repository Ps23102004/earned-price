import { describe, expect, it } from "vitest";
import { evaluate } from "../src/rules/evaluate";
import { price } from "../src/rules/price";
import type { EvaluationResult, PriceLine, Rule } from "../src/rules/types";
import { T0, at, cond, makeExampleRule, mkGuest, mkPr, mkSnap, oneTier } from "./helpers";

/** Hand-built evaluation result so price() is tested in isolation from evaluate(). */
function resultFor(rule: Rule, passed: string[], applied?: string): EvaluationResult {
  return {
    now: T0,
    tiers: rule.tiers.map((t) => ({
      tierId: t.id,
      label: t.label,
      discountPercent: t.discountPercent,
      passed: passed.includes(t.id),
      conditions: [],
    })),
    ...(applied !== undefined ? { appliedTierId: applied } : {}),
  };
}

const line = (tierId: string, label: string, discountPercent: number, status: PriceLine["status"], discountCents: number): PriceLine => ({
  tierId,
  label,
  discountPercent,
  status,
  discountCents,
});

describe("price: the brief's example on $49.00 (4900)", () => {
  const rule = makeExampleRule();

  it("all three tiers pass: 50% applied, 20% and 10% superseded, pays 2450", () => {
    expect(price(rule, resultFor(rule, ["t1", "t2", "t3"], "t1"), 4900)).toEqual({
      listCents: 4900,
      discountCents: 2450,
      earnedCents: 2450,
      appliedTierId: "t1",
      lines: [
        line("t1", "core contributor", 50, "applied", 2450),
        line("t2", "contributor", 20, "superseded", 0),
        line("t3", "veteran", 10, "superseded", 0),
      ],
    });
  });

  it("only the old-account tier passes: pays 4410", () => {
    expect(price(rule, resultFor(rule, ["t3"], "t3"), 4900)).toEqual({
      listCents: 4900,
      discountCents: 490,
      earnedCents: 4410,
      appliedTierId: "t3",
      lines: [
        line("t1", "core contributor", 50, "not_met", 0),
        line("t2", "contributor", 20, "not_met", 0),
        line("t3", "veteran", 10, "applied", 490),
      ],
    });
  });

  it("no tier passes (guest): pays 4900 with every line not_met", () => {
    const p = price(rule, resultFor(rule, []), 4900);
    expect(p.listCents).toBe(4900);
    expect(p.discountCents).toBe(0);
    expect(p.earnedCents).toBe(4900);
    expect(p.appliedTierId).toBeUndefined();
    expect(p.lines).toEqual([
      line("t1", "core contributor", 50, "not_met", 0),
      line("t2", "contributor", 20, "not_met", 0),
      line("t3", "veteran", 10, "not_met", 0),
    ]);
  });

  it("t2 and t3 pass: 20% applied, t3 superseded, t1 not_met", () => {
    const p = price(rule, resultFor(rule, ["t2", "t3"], "t2"), 4900);
    expect(p.discountCents).toBe(980);
    expect(p.earnedCents).toBe(3920);
    expect(p.lines.map((l) => [l.tierId, l.status, l.discountCents])).toEqual([
      ["t1", "not_met", 0],
      ["t2", "applied", 980],
      ["t3", "superseded", 0],
    ]);
  });

  it("lines keep the rule's tier order", () => {
    const p = price(rule, resultFor(rule, ["t1"], "t1"), 4900);
    expect(p.lines.map((l) => l.tierId)).toEqual(["t1", "t2", "t3"]);
  });
});

describe("price: end to end with evaluate (acceptance check 2)", () => {
  const rule = makeExampleRule();

  it("a buyer qualifying for all three pays 2450", () => {
    const snap = mkSnap({ mergedPrs: [mkPr({ repo: { stars: 5000 }, mergedAt: "2026-03-01T00:00:00.000Z" })] });
    const p = price(rule, evaluate(rule, snap), 4900);
    expect(p.earnedCents).toBe(2450);
    expect(p.appliedTierId).toBe("t1");
    expect(p.lines.map((l) => l.status)).toEqual(["applied", "superseded", "superseded"]);
  });

  it("a buyer with only an old account pays 4410", () => {
    const p = price(rule, evaluate(rule, mkSnap({ mergedPrs: [] })), 4900);
    expect(p.earnedCents).toBe(4410);
    expect(p.appliedTierId).toBe("t3");
    expect(p.lines.map((l) => l.status)).toEqual(["not_met", "not_met", "applied"]);
  });

  it("a guest pays 4900 with all tiers not_met", () => {
    const p = price(rule, evaluate(rule, mkGuest()), 4900);
    expect(p.earnedCents).toBe(4900);
    expect(p.discountCents).toBe(0);
    expect(p.appliedTierId).toBeUndefined();
    expect(p.lines.map((l) => l.status)).toEqual(["not_met", "not_met", "not_met"]);
  });
});

describe("price: rounding (half up, integer math)", () => {
  const discountFor = (listCents: number, percent: number) => {
    const rule = oneTier(cond("followers", 1), percent);
    const p = price(rule, resultFor(rule, ["t1"], "t1"), listCents);
    expect(p.discountCents + p.earnedCents).toBe(listCents);
    return p.discountCents;
  };

  it("999 at 50% rounds the 499.5 discount up to 500", () => {
    expect(discountFor(999, 50)).toBe(500);
  });

  it("101 at 33% rounds 33.33 down to 33", () => {
    expect(discountFor(101, 33)).toBe(33);
  });

  it("exact halves round up", () => {
    expect(discountFor(5, 10)).toBe(1); // 0.5 -> 1
    expect(discountFor(15, 10)).toBe(2); // 1.5 -> 2
    expect(discountFor(1, 50)).toBe(1); // 0.5 -> 1
  });

  it("below a half rounds down", () => {
    expect(discountFor(4, 10)).toBe(0); // 0.4 -> 0
    expect(discountFor(14, 10)).toBe(1); // 1.4 -> 1
  });

  it("exact percentages need no rounding", () => {
    expect(discountFor(4900, 50)).toBe(2450);
    expect(discountFor(4900, 10)).toBe(490);
    expect(discountFor(1000, 90)).toBe(900);
  });

  it("matches Math.floor((list * pct + 50) / 100) across a sweep", () => {
    for (const pct of [1, 7, 33, 50, 67, 90]) {
      for (let list = 1; list <= 300; list += 7) {
        expect(discountFor(list, pct), `${list} @ ${pct}%`).toBe(Math.floor((list * pct + 50) / 100));
      }
    }
  });
});

describe("price: invalid input", () => {
  const rule = makeExampleRule();
  const res = () => resultFor(rule, ["t3"], "t3");

  it.each([0, -1, -4900, 49.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY])("throws on listCents = %s", (bad) => {
    expect(() => price(rule, res(), bad)).toThrow();
  });

  it("throws when appliedTierId has no matching tier in the rule", () => {
    expect(() => price(rule, resultFor(rule, [], "ghost"), 4900)).toThrow();
  });

  it("takes discountPercent from the rule tier matched by id", () => {
    const r = oneTier(cond("followers", 1), 50);
    const tampered = resultFor(r, ["t1"], "t1");
    at(tampered.tiers, 0).discountPercent = 99;
    const p = price(r, tampered, 1000);
    expect(p.discountCents).toBe(500);
    expect(p.earnedCents).toBe(500);
  });
});
