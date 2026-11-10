// B2 explain: written from docs/specs/B2-facts-signin-price.md only.
import { describe, expect, it } from "vitest";
import { explain } from "../src/rules/explain";
import { evaluate } from "../src/rules/evaluate";
import { price } from "../src/rules/price";
import { readback } from "../src/rules/readback";
import type {
  Condition,
  ConditionResult,
  EvaluationResult,
  PriceResult,
  Rule,
  TierResult,
} from "../src/rules/types";
import { T0, at, daysBefore, makeExampleRule, mkPr, mkSnap, oneTier } from "./helpers";

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

/** The phrase `readback` uses for one condition, extracted from a one-tier rule's read-back line. */
function phraseOf(c: Condition): string {
  const first = readback(oneTier(c, 10, "x")).split("\n")[0] ?? "";
  const prefix = "10% off (Tier one) if ";
  expect(first.startsWith(prefix)).toBe(true);
  expect(first.endsWith(".")).toBe(true);
  return first.slice(prefix.length, -1);
}

function cr(c: Condition, actual: number, evidence: string[] = []): ConditionResult {
  const passed = actual >= c.value;
  return c.pr === undefined
    ? { field: c.field, op: "gte", threshold: c.value, actual, passed, evidence }
    : { field: c.field, op: "gte", threshold: c.value, actual, passed, evidence, pr: c.pr };
}

function tr(rule: Rule, tierIndex: number, conds: ConditionResult[]): TierResult {
  const t = at(rule.tiers, tierIndex);
  return {
    tierId: t.id,
    label: t.label,
    discountPercent: t.discountPercent,
    passed: conds.every((c) => c.passed),
    conditions: conds,
  };
}

function priceFor(rule: Rule, statuses: ("applied" | "superseded" | "not_met")[], listCents = 4900): PriceResult {
  const lines = rule.tiers.map((t, i) => ({
    tierId: t.id,
    label: t.label,
    discountPercent: t.discountPercent,
    status: at(statuses, i),
    discountCents: at(statuses, i) === "applied" ? Math.round((listCents * t.discountPercent) / 100) : 0,
  }));
  const applied = lines.find((l) => l.status === "applied");
  return {
    listCents,
    discountCents: applied?.discountCents ?? 0,
    earnedCents: listCents - (applied?.discountCents ?? 0),
    ...(applied ? { appliedTierId: applied.tierId } : {}),
    lines,
  };
}

// Example rule: t1 50% stars>=1000 (this year), t2 20% merged_prs>=1, t3 10% age>=1095.
const RULE = makeExampleRule();
const [C1, C2, C3] = [at(RULE.tiers, 0), at(RULE.tiers, 1), at(RULE.tiers, 2)].map((t) => at(t.conditions, 0));
const c1 = C1 as Condition;
const c2 = C2 as Condition;
const c3 = C3 as Condition;

describe("explain: mapping", () => {
  const evidenceUrl = "https://github.com/acme/widgets/pull/9";
  const result: EvaluationResult = {
    now: "2026-06-15T12:00:00.000Z",
    appliedTierId: "t2",
    tiers: [
      tr(RULE, 0, [cr(c1, 600)]),
      tr(RULE, 1, [cr(c2, 3, [evidenceUrl, "https://github.com/acme/widgets/pull/10"])]),
      tr(RULE, 2, [cr(c3, 2000)]),
    ],
  };
  const p = priceFor(RULE, ["not_met", "applied", "superseded"]);
  const view = explain(RULE, result, p);

  it("rows follow rule order with tier id, label and percent", () => {
    expect(view.rows.map((r) => [r.tierId, r.label, r.discountPercent])).toEqual([
      ["t1", "core contributor", 50],
      ["t2", "contributor", 20],
      ["t3", "veteran", 10],
    ]);
  });

  it("status mapping: not_met, applied, superseded", () => {
    expect(view.rows.map((r) => r.status)).toEqual(["not_met", "applied", "superseded"]);
  });

  it("top-level money, applied tier and evaluatedAt", () => {
    expect(view.listCents).toBe(4900);
    expect(view.discountCents).toBe(p.discountCents);
    expect(view.earnedCents).toBe(p.earnedCents);
    expect(view.discountCents).toBe(980);
    expect(view.earnedCents).toBe(3920);
    expect(view.appliedTierId).toBe("t2");
    expect(view.evaluatedAt).toBe(result.now);
    expect(view.evaluatedAt).toBe("2026-06-15T12:00:00.000Z");
  });

  it("condition fields: actual, threshold, passed", () => {
    const r1 = at(at(view.rows, 0).conditions, 0);
    const r2 = at(at(view.rows, 1).conditions, 0);
    const r3 = at(at(view.rows, 2).conditions, 0);
    expect([r1.actual, r1.threshold, r1.passed]).toEqual([600, 1000, false]);
    expect([r2.actual, r2.threshold, r2.passed]).toEqual([3, 1, true]);
    expect([r3.actual, r3.threshold, r3.passed]).toEqual([2000, 1095, true]);
  });

  it("evidence is passed through unchanged, including empty", () => {
    expect(at(at(view.rows, 1).conditions, 0).evidence).toEqual([evidenceUrl, "https://github.com/acme/widgets/pull/10"]);
    expect(at(at(view.rows, 0).conditions, 0).evidence).toEqual([]);
    expect(at(at(view.rows, 2).conditions, 0).evidence).toEqual([]);
  });

  it("condition text equals the read-back phrase for that condition", () => {
    expect(at(at(view.rows, 0).conditions, 0).text).toBe(phraseOf(c1));
    expect(at(at(view.rows, 1).conditions, 0).text).toBe(phraseOf(c2));
    expect(at(at(view.rows, 2).conditions, 0).text).toBe(phraseOf(c3));
    expect(at(at(view.rows, 2).conditions, 0).text).toBe("the GitHub account is at least 1,095 days old");
  });

  it("missing is only present on failed conditions", () => {
    expect(at(at(view.rows, 0).conditions, 0).missing).toBeDefined();
    expect(at(at(view.rows, 1).conditions, 0).missing).toBeUndefined();
    expect(at(at(view.rows, 2).conditions, 0).missing).toBeUndefined();
  });
});

describe("explain: no tier applies", () => {
  it("all rows not_met, no appliedTierId, zero discount, evaluatedAt = result.now", () => {
    const result: EvaluationResult = {
      now: "2027-01-02T03:04:05.000Z",
      tiers: [tr(RULE, 0, [cr(c1, 0)]), tr(RULE, 1, [cr(c2, 0)]), tr(RULE, 2, [cr(c3, 10)])],
    };
    const view = explain(RULE, result, priceFor(RULE, ["not_met", "not_met", "not_met"]));
    expect(view.rows.map((r) => r.status)).toEqual(["not_met", "not_met", "not_met"]);
    expect(view.appliedTierId).toBeUndefined();
    expect(view.discountCents).toBe(0);
    expect(view.earnedCents).toBe(4900);
    expect(view.listCents).toBe(4900);
    expect(view.evaluatedAt).toBe("2027-01-02T03:04:05.000Z");
  });
});

describe("explain: missing strings", () => {
  function missingFor(c: Condition, actual: number): string | undefined {
    const rule = oneTier(c);
    const result: EvaluationResult = { now: T0, tiers: [tr(rule, 0, [cr(c, actual)])] };
    const view = explain(rule, result, priceFor(rule, ["not_met"]));
    return at(at(view.rows, 0).conditions, 0).missing;
  }

  it.each([
    ["followers", 10, 3, "needs 7 more"],
    ["public_repos", 5, 0, "needs 5 more"],
    ["commit_contributions_last_year", 100, 99, "needs 1 more"],
    ["merged_prs", 4, 1, "needs 3 more"],
    ["merged_prs", 1, 0, "needs 1 more"],
  ] as const)("count field %s threshold %d actual %d -> %s", (field, threshold, actual, expected) => {
    expect(missingFor({ field, op: "gte", value: threshold }, actual)).toBe(expected);
  });

  it("account_age_days -> needs N more days", () => {
    expect(missingFor({ field: "account_age_days", op: "gte", value: 1095 }, 1000)).toBe("needs 95 more days");
    expect(missingFor({ field: "account_age_days", op: "gte", value: 400 }, 399)).toBe("needs 1 more days");
  });

  it("max_repo_stars_merged_pr with actual 0 -> needs a repository with at least N stars", () => {
    expect(missingFor({ field: "max_repo_stars_merged_pr", op: "gte", value: 500 }, 0)).toBe(
      "needs a repository with at least 500 stars",
    );
  });

  it("max_repo_stars_merged_pr with actual > 0 -> needs N more stars (threshold - actual)", () => {
    expect(missingFor({ field: "max_repo_stars_merged_pr", op: "gte", value: 500 }, 300)).toBe("needs 200 more stars");
    expect(missingFor({ field: "max_repo_stars_merged_pr", op: "gte", value: 500 }, 499)).toBe("needs 1 more stars");
  });

  it("passed conditions carry no missing for any field", () => {
    expect(missingFor({ field: "followers", op: "gte", value: 3 }, 3)).toBeUndefined();
    expect(missingFor({ field: "account_age_days", op: "gte", value: 3 }, 50)).toBeUndefined();
    expect(missingFor({ field: "max_repo_stars_merged_pr", op: "gte", value: 500 }, 900)).toBeUndefined();
  });
});

describe("explain: multi-condition tier with PR filters", () => {
  const filters = { excludeOwnRepos: true, minLinesChanged: 10 } as const;
  const rule: Rule = {
    version: 1,
    tiers: [
      {
        id: "t20",
        label: "Any merged PR",
        discountPercent: 20,
        conditions: [
          { field: "merged_prs", op: "gte", value: 3, pr: { ...filters } },
          { field: "followers", op: "gte", value: 5 },
        ],
      },
    ],
  };
  const conds = rule.tiers[0]?.conditions ?? [];
  const result: EvaluationResult = {
    now: T0,
    tiers: [tr(rule, 0, [cr(at(conds, 0), 1, ["https://github.com/a/b/pull/1"]), cr(at(conds, 1), 9)])],
  };
  const view = explain(rule, result, priceFor(rule, ["not_met"]));
  const row = at(view.rows, 0);

  it("keeps condition order and one entry per condition", () => {
    expect(row.conditions).toHaveLength(2);
    expect(at(row.conditions, 0).passed).toBe(false);
    expect(at(row.conditions, 1).passed).toBe(true);
  });

  it("text includes the PR filter wording exactly as readback does", () => {
    expect(at(row.conditions, 0).text).toBe(phraseOf(at(conds, 0)));
    expect(at(row.conditions, 0).text).toContain("not into the author's own repositories");
    expect(at(row.conditions, 1).text).toBe(phraseOf(at(conds, 1)));
  });

  it("missing only on the failed one", () => {
    expect(at(row.conditions, 0).missing).toBe("needs 2 more");
    expect(at(row.conditions, 1).missing).toBeUndefined();
  });
});

describe("explain: purity", () => {
  it("does not mutate frozen inputs and is repeatable", () => {
    const result = deepFreeze<EvaluationResult>({
      now: T0,
      appliedTierId: "t3",
      tiers: [tr(RULE, 0, [cr(c1, 0)]), tr(RULE, 1, [cr(c2, 0)]), tr(RULE, 2, [cr(c3, 1100)])],
    });
    const p = deepFreeze(priceFor(RULE, ["not_met", "not_met", "applied"]));
    const rule = deepFreeze(makeExampleRule());
    const a = explain(rule, result, p);
    const b = explain(rule, result, p);
    expect(a).toEqual(b);
    expect(a.appliedTierId).toBe("t3");
    expect(at(a.rows, 2).status).toBe("applied");
  });

  it("agrees with the real evaluate/price pipeline for the example rule", () => {
    const snap = mkSnap({
      user: { createdAt: daysBefore(T0, 2000) },
      mergedPrs: [mkPr({ mergedAt: "2026-03-01T00:00:00.000Z", repo: { stars: 300 } })],
    });
    const result = evaluate(RULE, snap, new Date(T0));
    const p = price(RULE, result, 4900);
    const view = explain(RULE, result, p);
    expect(view.appliedTierId).toBe("t2");
    expect(view.rows.map((r) => r.status)).toEqual(["not_met", "applied", "superseded"]);
    expect(view.earnedCents).toBe(p.earnedCents);
    expect(view.evaluatedAt).toBe(result.now);
    expect(at(at(view.rows, 0).conditions, 0).missing).toBe("needs 700 more stars");
  });
});
