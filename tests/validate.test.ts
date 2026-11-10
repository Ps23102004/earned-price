import { describe, expect, it } from "vitest";
import { isNotLooser, validateRule } from "../src/rules/validate";
import { FIELDS, FIELD_MAX, PR_FIELDS, type Condition, type PrFilters, type Rule } from "../src/rules/types";
import { at, cond, makeExampleRule } from "./helpers";

type Raw = Record<string, unknown>;
const MISSING = Symbol("missing");
const clean = (o: Raw): Raw => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== MISSING));

/** A minimal valid rule as untyped data; patches override (or MISSING-delete) keys at each level. */
function build(p: { rule?: Raw; tier?: Raw; cond?: Raw; pr?: Raw } = {}): unknown {
  const c = clean({ field: "merged_prs", op: "gte", value: 1, ...(p.pr ? { pr: p.pr } : {}), ...p.cond });
  const tier = clean({ id: "t1", label: "Tier one", discountPercent: 10, conditions: [c], ...p.tier });
  return clean({ version: 1, tiers: [tier], ...p.rule });
}
const rawTier = (id: string): Raw => ({
  id,
  label: `Tier ${id}`,
  discountPercent: 10,
  conditions: [{ field: "followers", op: "gte", value: 1 }],
});

function expectInvalid(input: unknown): void {
  const r = validateRule(input);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(1);
}
function expectValid(input: unknown): void {
  const r = validateRule(input);
  expect(r.ok, JSON.stringify(r)).toBe(true);
}

describe("validateRule: accepts", () => {
  it("accepts the example rule and returns an equal rule", () => {
    const input = makeExampleRule();
    const r = validateRule(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rule).toEqual(makeExampleRule());
  });

  it("returns a clean copy, not the input object", () => {
    const input = makeExampleRule();
    const r = validateRule(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rule).not.toBe(input);
      expect(r.rule.tiers).not.toBe(input.tiers);
    }
  });

  it("accepts the example rule after a JSON round trip", () => {
    const r = validateRule(JSON.parse(JSON.stringify(makeExampleRule())));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rule).toEqual(makeExampleRule());
  });

  it("accepts the minimal built rule", () => {
    expectValid(build());
  });

  it("accepts 3 tiers and 3 conditions", () => {
    expectValid(build({ rule: { tiers: [rawTier("a"), rawTier("b"), rawTier("c")] } }));
    const conds = [1, 2, 3].map((v) => ({ field: "followers", op: "gte", value: v }));
    expectValid(build({ tier: { conditions: conds } }));
  });

  it("accepts discountPercent 1 and 90", () => {
    expectValid(build({ tier: { discountPercent: 1 } }));
    expectValid(build({ tier: { discountPercent: 90 } }));
  });

  it("accepts tier id of 1 and 32 chars from [a-z0-9_-]", () => {
    expectValid(build({ tier: { id: "a" } }));
    expectValid(build({ tier: { id: "a_b-9".padEnd(32, "z") } }));
  });

  it("accepts labels of length 1 and 80", () => {
    expectValid(build({ tier: { label: "x" } }));
    expectValid(build({ tier: { label: "x".repeat(80) } }));
  });

  it.each(FIELDS.map((f) => [f, FIELD_MAX[f]] as const))("accepts %s with value 1 and FIELD_MAX (%i)", (field, max) => {
    expectValid(build({ cond: { field, value: 1 } }));
    expectValid(build({ cond: { field, value: max } }));
  });

  it("accepts pr filters at their bounds", () => {
    expectValid(build({ pr: { minRepoStars: 1 } }));
    expectValid(build({ pr: { minRepoStars: 10_000_000 } }));
    expectValid(build({ pr: { minLinesChanged: 1 } }));
    expectValid(build({ pr: { minLinesChanged: 1_000_000 } }));
    expectValid(build({ pr: { minAccountAgeDaysAtMerge: 1 } }));
    expectValid(build({ pr: { minAccountAgeDaysAtMerge: 15_000 } }));
    expectValid(build({ pr: { excludeOwnRepos: true, excludeForks: false } }));
  });

  it("accepts mergedSince year_start and valid dates (incl. 2008-01-01 and a leap day)", () => {
    expectValid(build({ pr: { mergedSince: "year_start" } }));
    expectValid(build({ pr: { mergedSince: "2008-01-01" } }));
    expectValid(build({ pr: { mergedSince: "2024-02-29" } }));
    expectValid(build({ pr: { mergedSince: "2026-12-31" } }));
  });

  it("accepts all pr filters together on max_repo_stars_merged_pr", () => {
    expectValid(
      build({
        cond: { field: "max_repo_stars_merged_pr", value: 1000 },
        pr: {
          minRepoStars: 10,
          minLinesChanged: 5,
          excludeOwnRepos: true,
          excludeForks: true,
          mergedSince: "year_start",
          minAccountAgeDaysAtMerge: 30,
        },
      }),
    );
  });
});

describe("validateRule: rejects", () => {
  describe("non-object input", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a string", "rule"],
      ["a number", 42],
      ["a boolean", true],
      ["an array", []],
    ])("%s", (_name, input) => {
      expectInvalid(input);
    });
  });

  describe("unknown keys", () => {
    it("at rule level", () => expectInvalid(build({ rule: { extra: 1 } })));
    it("at tier level", () => expectInvalid(build({ tier: { extra: 1 } })));
    it("at condition level", () => expectInvalid(build({ cond: { extra: 1 } })));
    it("in pr filters", () => expectInvalid(build({ pr: { minRepoStars: 5, nope: true } })));
  });

  describe("version", () => {
    it("version 2", () => expectInvalid(build({ rule: { version: 2 } })));
    it("version '1' (string)", () => expectInvalid(build({ rule: { version: "1" } })));
    it("version missing", () => expectInvalid(build({ rule: { version: MISSING } })));
  });

  describe("tiers", () => {
    it("tiers missing", () => expectInvalid(build({ rule: { tiers: MISSING } })));
    it("tiers not an array (object)", () => expectInvalid(build({ rule: { tiers: { 0: rawTier("a") } } })));
    it("tiers not an array (string)", () => expectInvalid(build({ rule: { tiers: "t1" } })));
    it("tiers empty", () => expectInvalid(build({ rule: { tiers: [] } })));
    it("4 tiers", () =>
      expectInvalid(build({ rule: { tiers: [rawTier("a"), rawTier("b"), rawTier("c"), rawTier("d")] } })));
    it("duplicate tier ids", () => expectInvalid(build({ rule: { tiers: [rawTier("a"), rawTier("a")] } })));
    it("a tier that is null", () => expectInvalid(build({ rule: { tiers: [null] } })));
  });

  describe("tier id", () => {
    it.each([
      ["uppercase", "Core"],
      ["space", "has space"],
      ["empty", ""],
      ["33 chars", "a".repeat(33)],
      ["dot", "a.b"],
      ["unicode", "café"],
      ["a number", 5],
      ["null", null],
    ])("%s", (_n, id) => expectInvalid(build({ tier: { id } })));
    it("missing", () => expectInvalid(build({ tier: { id: MISSING } })));
  });

  describe("tier label", () => {
    it("empty", () => expectInvalid(build({ tier: { label: "" } })));
    it("81 chars", () => expectInvalid(build({ tier: { label: "x".repeat(81) } })));
    it("not a string", () => expectInvalid(build({ tier: { label: 5 } })));
    it("missing", () => expectInvalid(build({ tier: { label: MISSING } })));
  });

  describe("discountPercent", () => {
    it.each([
      ["0", 0],
      ["91", 91],
      ["100", 100],
      ["-5", -5],
      ["1.5", 1.5],
      ["a numeric string", "50"],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["null", null],
    ])("%s", (_n, v) => expectInvalid(build({ tier: { discountPercent: v } })));
    it("missing", () => expectInvalid(build({ tier: { discountPercent: MISSING } })));
  });

  describe("conditions array", () => {
    it("not an array", () => expectInvalid(build({ tier: { conditions: { field: "followers" } } })));
    it("empty", () => expectInvalid(build({ tier: { conditions: [] } })));
    it("4 conditions", () => {
      const conds = [1, 2, 3, 4].map((v) => ({ field: "followers", op: "gte", value: v }));
      expectInvalid(build({ tier: { conditions: conds } }));
    });
    it("missing", () => expectInvalid(build({ tier: { conditions: MISSING } })));
    it("a condition that is null", () => expectInvalid(build({ tier: { conditions: [null] } })));
  });

  describe("field and op", () => {
    it("field not in FIELDS", () => expectInvalid(build({ cond: { field: "stars" } })));
    it("field missing", () => expectInvalid(build({ cond: { field: MISSING } })));
    it("field not a string", () => expectInvalid(build({ cond: { field: 3 } })));
    it.each(["lte", "gt", "lt", "eq", ">=", "GTE"])("op %s", (op) => expectInvalid(build({ cond: { op } })));
    it("op missing", () => expectInvalid(build({ cond: { op: MISSING } })));
  });

  describe("value", () => {
    it.each([
      ["0", 0],
      ["-1", -1],
      ["1.5", 1.5],
      ["a numeric string", "5"],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["null", null],
    ])("%s", (_n, v) => expectInvalid(build({ cond: { value: v } })));
    it("missing", () => expectInvalid(build({ cond: { value: MISSING } })));
    it.each(FIELDS.map((f) => [f, FIELD_MAX[f] + 1] as const))("%s with value FIELD_MAX + 1 (%i)", (field, v) => {
      expectInvalid(build({ cond: { field, value: v } }));
    });
  });

  describe("pr on a field not in PR_FIELDS", () => {
    const nonPr = FIELDS.filter((f) => !PR_FIELDS.includes(f));
    it.each(nonPr)("%s", (field) => {
      expectInvalid(build({ cond: { field }, pr: { minRepoStars: 5 } }));
    });
  });

  describe("pr filter values", () => {
    it.each([
      ["minRepoStars 0", { minRepoStars: 0 }],
      ["minRepoStars 10_000_001", { minRepoStars: 10_000_001 }],
      ["minRepoStars 1.5", { minRepoStars: 1.5 }],
      ["minRepoStars string", { minRepoStars: "5" }],
      ["minRepoStars NaN", { minRepoStars: Number.NaN }],
      ["minLinesChanged 0", { minLinesChanged: 0 }],
      ["minLinesChanged 1_000_001", { minLinesChanged: 1_000_001 }],
      ["minLinesChanged 1.5", { minLinesChanged: 1.5 }],
      ["minAccountAgeDaysAtMerge 0", { minAccountAgeDaysAtMerge: 0 }],
      ["minAccountAgeDaysAtMerge 15_001", { minAccountAgeDaysAtMerge: 15_001 }],
      ["minAccountAgeDaysAtMerge 1.5", { minAccountAgeDaysAtMerge: 1.5 }],
      ["excludeOwnRepos 'true'", { excludeOwnRepos: "true" }],
      ["excludeOwnRepos 1", { excludeOwnRepos: 1 }],
      ["excludeForks 'yes'", { excludeForks: "yes" }],
      ["excludeForks 0", { excludeForks: 0 }],
      ["mergedSince 'last_year'", { mergedSince: "last_year" }],
      ["mergedSince month 13", { mergedSince: "2026-13-01" }],
      ["mergedSince Feb 30", { mergedSince: "2026-02-30" }],
      ["mergedSince Feb 29 in a non-leap year", { mergedSince: "2023-02-29" }],
      ["mergedSince before 2008-01-01", { mergedSince: "2007-12-31" }],
      ["mergedSince without zero padding", { mergedSince: "2026-1-1" }],
      ["mergedSince a full timestamp", { mergedSince: "2026-06-15T00:00:00Z" }],
      ["mergedSince a number", { mergedSince: 2026 }],
      ["mergedSince empty string", { mergedSince: "" }],
    ])("%s", (_n, pr) => expectInvalid(build({ pr })));
  });

  it("does not throw on hostile input", () => {
    expect(() => validateRule({ version: 1, tiers: [{ id: {}, label: [], discountPercent: {}, conditions: 7 }] })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isNotLooser
// ---------------------------------------------------------------------------

function mod(f: (r: Rule) => void): Rule {
  const r = makeExampleRule();
  f(r);
  return r;
}
const tierAt = (r: Rule, i: number) => at(r.tiers, i);
const condAt = (r: Rule, i: number, j = 0): Condition => at(tierAt(r, i).conditions, j);

function filtered(pr: PrFilters | undefined): Rule {
  return {
    version: 1,
    tiers: [{ id: "t1", label: "L", discountPercent: 30, conditions: [cond("merged_prs", 2, pr)] }],
  };
}
const FULL: PrFilters = {
  minRepoStars: 100,
  minLinesChanged: 50,
  excludeOwnRepos: true,
  excludeForks: true,
  mergedSince: "year_start",
  minAccountAgeDaysAtMerge: 30,
};

describe("isNotLooser: accepts", () => {
  it("an identical rule", () => {
    expect(isNotLooser(makeExampleRule(), makeExampleRule())).toBe(true);
  });

  it("a label change", () => {
    const n = mod((r) => {
      tierAt(r, 0).label = "renamed";
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(true);
  });

  it("adding minLinesChanged to an existing pr filter", () => {
    const n = mod((r) => {
      condAt(r, 0).pr = { mergedSince: "year_start", minLinesChanged: 50 };
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(true);
  });

  it("adding excludeOwnRepos where the old condition had no pr at all", () => {
    const n = mod((r) => {
      condAt(r, 1).pr = { excludeOwnRepos: true };
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(true);
  });

  it("adding an extra account_age_days condition at the end", () => {
    const n = mod((r) => {
      tierAt(r, 1).conditions.push(cond("account_age_days", 365));
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(true);
  });

  it("raising a threshold", () => {
    const n = mod((r) => {
      condAt(r, 2).value = 1500;
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(true);
  });

  it("raising several thresholds at once", () => {
    const n = mod((r) => {
      condAt(r, 0).value = 5000;
      condAt(r, 1).value = 3;
      condAt(r, 2).value = 2000;
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(true);
  });

  it("keeping the identical mergedSince (year_start and a date)", () => {
    expect(isNotLooser(makeExampleRule(), makeExampleRule())).toBe(true);
    const a = filtered({ mergedSince: "2026-02-01" });
    const b = filtered({ mergedSince: "2026-02-01", minRepoStars: 5 });
    expect(isNotLooser(a, b)).toBe(true);
  });

  it("raising every numeric filter and keeping every boolean filter", () => {
    const n = filtered({ ...FULL, minRepoStars: 200, minLinesChanged: 51, minAccountAgeDaysAtMerge: 31 });
    expect(isNotLooser(filtered(FULL), n)).toBe(true);
  });

  it("equal numeric filters", () => {
    expect(isNotLooser(filtered(FULL), filtered({ ...FULL }))).toBe(true);
  });

  it("new may add a mergedSince that old lacked", () => {
    expect(isNotLooser(filtered({ minRepoStars: 5 }), filtered({ minRepoStars: 5, mergedSince: "year_start" }))).toBe(true);
  });

  it("an old boolean filter set to false does not constrain the new rule", () => {
    expect(isNotLooser(filtered({ excludeOwnRepos: false }), filtered(undefined))).toBe(true);
  });

  it("extra conditions after counterparts of every old condition (two-condition tier)", () => {
    const old: Rule = {
      version: 1,
      tiers: [{ id: "t1", label: "L", discountPercent: 10, conditions: [cond("followers", 5), cond("public_repos", 3)] }],
    };
    const n: Rule = {
      version: 1,
      tiers: [
        {
          id: "t1",
          label: "L",
          discountPercent: 10,
          conditions: [cond("followers", 6), cond("public_repos", 3), cond("account_age_days", 10)],
        },
      ],
    };
    expect(isNotLooser(old, n)).toBe(true);
  });
});

describe("isNotLooser: rejects", () => {
  it("lowering a threshold", () => {
    const n = mod((r) => {
      condAt(r, 2).value = 1000;
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it("lowering a threshold by one", () => {
    const n = mod((r) => {
      condAt(r, 2).value = 1094;
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it("increasing a discount", () => {
    const n = mod((r) => {
      tierAt(r, 2).discountPercent = 15;
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it("decreasing a discount (any change is rejected)", () => {
    const n = mod((r) => {
      tierAt(r, 2).discountPercent = 5;
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it("removing a condition", () => {
    const old: Rule = {
      version: 1,
      tiers: [{ id: "t1", label: "L", discountPercent: 10, conditions: [cond("followers", 5), cond("public_repos", 3)] }],
    };
    const n: Rule = {
      version: 1,
      tiers: [{ id: "t1", label: "L", discountPercent: 10, conditions: [cond("followers", 5)] }],
    };
    expect(isNotLooser(old, n)).toBe(false);
  });

  it("reordering old conditions within a tier", () => {
    const old: Rule = {
      version: 1,
      tiers: [{ id: "t1", label: "L", discountPercent: 10, conditions: [cond("followers", 5), cond("public_repos", 3)] }],
    };
    const n: Rule = {
      version: 1,
      tiers: [{ id: "t1", label: "L", discountPercent: 10, conditions: [cond("public_repos", 3), cond("followers", 5)] }],
    };
    expect(isNotLooser(old, n)).toBe(false);
  });

  it("an extra condition inserted before the old ones (must begin with the counterparts)", () => {
    const n = mod((r) => {
      tierAt(r, 2).conditions.unshift(cond("followers", 5));
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it("reordering tiers", () => {
    const n = mod((r) => {
      r.tiers.reverse();
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it("swapping the first two tiers", () => {
    const n = mod((r) => {
      const [a, b] = [tierAt(r, 0), tierAt(r, 1)];
      r.tiers[0] = b;
      r.tiers[1] = a;
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it("changing a tier id", () => {
    const n = mod((r) => {
      tierAt(r, 0).id = "renamed";
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it("removing a tier", () => {
    const n = mod((r) => {
      r.tiers.pop();
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it("adding a tier", () => {
    const n = mod((r) => {
      r.tiers.push({ id: "t4", label: "new", discountPercent: 5, conditions: [cond("followers", 5)] });
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it("changing a condition's field", () => {
    const n = mod((r) => {
      condAt(r, 2).field = "followers";
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it("dropping the pr filters entirely (old had mergedSince)", () => {
    const n = mod((r) => {
      delete condAt(r, 0).pr;
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it("dropping mergedSince but keeping another filter", () => {
    const n = mod((r) => {
      condAt(r, 0).pr = { minRepoStars: 10 };
    });
    expect(isNotLooser(makeExampleRule(), n)).toBe(false);
  });

  it.each(Object.keys(FULL) as Array<keyof PrFilters>)("dropping the %s filter", (key) => {
    const without: PrFilters = { ...FULL };
    delete without[key];
    expect(isNotLooser(filtered(FULL), filtered(without))).toBe(false);
  });

  it.each([
    ["minRepoStars", { minRepoStars: 99 }],
    ["minLinesChanged", { minLinesChanged: 49 }],
    ["minAccountAgeDaysAtMerge", { minAccountAgeDaysAtMerge: 29 }],
  ] as const)("lowering %s", (_k, patch) => {
    expect(isNotLooser(filtered(FULL), filtered({ ...FULL, ...patch }))).toBe(false);
  });

  it.each(["excludeOwnRepos", "excludeForks"] as const)("setting %s from true to false", (key) => {
    expect(isNotLooser(filtered(FULL), filtered({ ...FULL, [key]: false }))).toBe(false);
  });

  it("changing mergedSince from year_start to a date", () => {
    expect(isNotLooser(filtered({ mergedSince: "year_start" }), filtered({ mergedSince: "2026-01-01" }))).toBe(false);
  });

  it("changing mergedSince from a date to year_start", () => {
    expect(isNotLooser(filtered({ mergedSince: "2026-01-01" }), filtered({ mergedSince: "year_start" }))).toBe(false);
  });

  it("changing mergedSince to a later date (identity is required)", () => {
    expect(isNotLooser(filtered({ mergedSince: "2026-01-01" }), filtered({ mergedSince: "2026-02-01" }))).toBe(false);
  });

  it("is not symmetric: the tightened rule's looser original is rejected", () => {
    const tighter = mod((r) => {
      condAt(r, 2).value = 1500;
    });
    expect(isNotLooser(makeExampleRule(), tighter)).toBe(true);
    expect(isNotLooser(tighter, makeExampleRule())).toBe(false);
  });
});
