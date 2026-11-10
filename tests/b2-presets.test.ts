// B2 presets: written from docs/specs/B2-facts-signin-price.md only.
import { describe, expect, it } from "vitest";
import { DEFAULT_RULE, LOOSE_RULE, PRESETS } from "../src/rules/presets";
import { evaluate } from "../src/rules/evaluate";
import { price } from "../src/rules/price";
import { isNotLooser, validateRule } from "../src/rules/validate";
import { T0, daysBefore, mkGuest, mkPr, mkSnap } from "./helpers";

const NOW = new Date(T0); // 2026-06-15, so year_start = 2026-01-01
const LIST = 4900;

function run(rule: typeof LOOSE_RULE, snap: Parameters<typeof evaluate>[1]) {
  const result = evaluate(rule, snap, NOW);
  return { result, priced: price(rule, result, LIST) };
}

describe("LOOSE_RULE shape", () => {
  it("is a version 1 rule with tiers t50, t20, t10 in that order", () => {
    expect(LOOSE_RULE.version).toBe(1);
    expect(LOOSE_RULE.tiers.map((t) => t.id)).toEqual(["t50", "t20", "t10"]);
  });

  it("has the exact labels and percents", () => {
    expect(LOOSE_RULE.tiers.map((t) => [t.label, t.discountPercent])).toEqual([
      ["OSS contributor", 50],
      ["Any merged PR", 20],
      ["Veteran account", 10],
    ]);
  });

  it("has the exact conditions", () => {
    const [t50, t20, t10] = LOOSE_RULE.tiers;
    expect(t50?.conditions).toEqual([
      { field: "max_repo_stars_merged_pr", op: "gte", value: 1000, pr: { mergedSince: "year_start" } },
    ]);
    expect(t20?.conditions).toEqual([{ field: "merged_prs", op: "gte", value: 1 }]);
    expect(t10?.conditions).toEqual([{ field: "account_age_days", op: "gte", value: 1095 }]);
  });
});

describe("DEFAULT_RULE shape", () => {
  it("has the same ids, labels and percents as LOOSE_RULE", () => {
    expect(DEFAULT_RULE.version).toBe(1);
    expect(DEFAULT_RULE.tiers.map((t) => [t.id, t.label, t.discountPercent])).toEqual(
      LOOSE_RULE.tiers.map((t) => [t.id, t.label, t.discountPercent]),
    );
  });

  it("t50 is hardened with own-repo, fork and min-lines filters", () => {
    expect(DEFAULT_RULE.tiers[0]?.conditions).toEqual([
      {
        field: "max_repo_stars_merged_pr",
        op: "gte",
        value: 1000,
        pr: { mergedSince: "year_start", excludeOwnRepos: true, excludeForks: true, minLinesChanged: 10 },
      },
    ]);
  });

  it("t20 excludes own repos and needs 10 changed lines", () => {
    expect(DEFAULT_RULE.tiers[1]?.conditions).toEqual([
      { field: "merged_prs", op: "gte", value: 1, pr: { excludeOwnRepos: true, minLinesChanged: 10 } },
    ]);
  });

  it("t10 needs account age >= 1095 AND public_repos >= 1", () => {
    expect(DEFAULT_RULE.tiers[2]?.conditions).toEqual([
      { field: "account_age_days", op: "gte", value: 1095 },
      { field: "public_repos", op: "gte", value: 1 },
    ]);
  });
});

describe("PRESETS and validation", () => {
  it("PRESETS maps loose and default to the two rules", () => {
    expect(PRESETS.loose).toEqual(LOOSE_RULE);
    expect(PRESETS.default).toEqual(DEFAULT_RULE);
  });

  it("both rules pass validateRule", () => {
    expect(validateRule(LOOSE_RULE).ok).toBe(true);
    expect(validateRule(DEFAULT_RULE).ok).toBe(true);
  });

  it("isNotLooser(LOOSE, DEFAULT) is true and the reverse is false", () => {
    expect(isNotLooser(LOOSE_RULE, DEFAULT_RULE)).toBe(true);
    expect(isNotLooser(DEFAULT_RULE, LOOSE_RULE)).toBe(false);
  });
});

describe("brief evaluation outcomes", () => {
  it("own-repo tiny PR into a 5,000-star repo: t50 under LOOSE, not under DEFAULT", () => {
    const snap = mkSnap({
      mergedPrs: [
        mkPr({
          additions: 1,
          deletions: 1,
          mergedAt: "2026-03-01T00:00:00.000Z",
          repo: { stars: 5000, ownerIsAuthor: true, ownerType: "User", isFork: false },
        }),
      ],
    });
    const loose = run(LOOSE_RULE, snap);
    const def = run(DEFAULT_RULE, snap);
    expect(loose.result.appliedTierId).toBe("t50");
    expect(loose.priced.discountCents).toBe(2450);
    expect(def.result.appliedTierId).not.toBe("t50");
    expect(def.priced.discountCents).toBeLessThan(2450);
  });

  it("tiny PR (2 lines) into someone else's 5,000-star repo: t50 under LOOSE only", () => {
    const snap = mkSnap({
      mergedPrs: [mkPr({ additions: 1, deletions: 1, mergedAt: "2026-03-01T00:00:00.000Z" })],
    });
    expect(run(LOOSE_RULE, snap).result.appliedTierId).toBe("t50");
    expect(run(DEFAULT_RULE, snap).result.appliedTierId).not.toBe("t50");
  });

  it("PR into a fork: t50 under LOOSE only", () => {
    const snap = mkSnap({
      mergedPrs: [
        mkPr({ additions: 100, deletions: 50, repo: { stars: 5000, isFork: true, ownerIsAuthor: false } }),
      ],
    });
    expect(run(LOOSE_RULE, snap).result.appliedTierId).toBe("t50");
    expect(run(DEFAULT_RULE, snap).result.appliedTierId).not.toBe("t50");
  });

  it("a genuine PR (50 lines, other owner, not a fork, this year) gets t50 under both", () => {
    const snap = mkSnap({
      mergedPrs: [mkPr({ additions: 40, deletions: 10, mergedAt: "2026-02-01T00:00:00.000Z" })],
    });
    const def = run(DEFAULT_RULE, snap);
    expect(run(LOOSE_RULE, snap).result.appliedTierId).toBe("t50");
    expect(def.result.appliedTierId).toBe("t50");
    expect(def.priced.earnedCents).toBe(2450);
  });

  it("a big PR merged last calendar year does not earn t50 under either rule", () => {
    const snap = mkSnap({
      mergedPrs: [mkPr({ additions: 400, deletions: 10, mergedAt: "2025-12-31T23:59:59.000Z" })],
    });
    expect(run(LOOSE_RULE, snap).result.appliedTierId).toBe("t20");
    expect(run(DEFAULT_RULE, snap).result.appliedTierId).not.toBe("t50");
  });

  it("account >= 1095 days old, no PRs, public_repos 0: t10 under LOOSE, nothing under DEFAULT", () => {
    const snap = mkSnap({ user: { createdAt: daysBefore(T0, 1500), publicRepos: 0 }, mergedPrs: [] });
    const loose = run(LOOSE_RULE, snap);
    const def = run(DEFAULT_RULE, snap);
    expect(loose.result.appliedTierId).toBe("t10");
    expect(loose.priced.earnedCents).toBe(4410);
    expect(def.result.appliedTierId).toBeUndefined();
    expect(def.priced.discountCents).toBe(0);
    expect(def.priced.earnedCents).toBe(LIST);
  });

  it("the 1095-day boundary: exactly 1095 days qualifies for LOOSE t10, 1094 does not", () => {
    const at1095 = mkSnap({ user: { createdAt: daysBefore(T0, 1095), publicRepos: 0 } });
    const at1094 = mkSnap({ user: { createdAt: daysBefore(T0, 1094), publicRepos: 0 } });
    expect(run(LOOSE_RULE, at1095).result.appliedTierId).toBe("t10");
    expect(run(LOOSE_RULE, at1094).result.appliedTierId).toBeUndefined();
  });

  it("an old account with at least one public repo gets t10 under DEFAULT", () => {
    const snap = mkSnap({ user: { createdAt: daysBefore(T0, 1500), publicRepos: 1 } });
    expect(run(DEFAULT_RULE, snap).result.appliedTierId).toBe("t10");
  });

  it("guest gets nothing under either rule", () => {
    for (const rule of [LOOSE_RULE, DEFAULT_RULE]) {
      const { result, priced } = run(rule, mkGuest());
      expect(result.appliedTierId).toBeUndefined();
      expect(priced.discountCents).toBe(0);
      expect(priced.earnedCents).toBe(LIST);
    }
  });
});
