// B2 searchWindow: written from docs/specs/B2-facts-signin-price.md only.
import { describe, expect, it } from "vitest";
import { searchWindow } from "../src/facts/window";
import type { Rule } from "../src/rules/types";
import { cond, oneTier } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00.000Z");

function rule(...tiers: Rule["tiers"][number]["conditions"][]): Rule {
  return {
    version: 1,
    tiers: tiers.map((conditions, i) => ({
      id: `t${i + 1}`,
      label: `Tier ${i + 1}`,
      discountPercent: 10 + i,
      conditions,
    })),
  };
}

describe("searchWindow: PR need", () => {
  it("no PR fields -> needsPrs false and no date", () => {
    const r = searchWindow(
      rule([cond("account_age_days", 100), cond("followers", 5)], [cond("public_repos", 1)]),
      NOW,
    );
    expect(r.needsPrs).toBe(false);
    expect(r.mergedSince).toBeUndefined();
    expect(r).toEqual({ needsPrs: false });
  });

  it("commit_contributions_last_year is not a PR field", () => {
    expect(searchWindow(oneTier(cond("commit_contributions_last_year", 50)), NOW).needsPrs).toBe(false);
  });

  it("merged_prs without mergedSince -> needsPrs true, no date", () => {
    const r = searchWindow(oneTier(cond("merged_prs", 1)), NOW);
    expect(r.needsPrs).toBe(true);
    expect(r.mergedSince).toBeUndefined();
  });

  it("max_repo_stars_merged_pr without mergedSince -> needsPrs true, no date", () => {
    const r = searchWindow(oneTier(cond("max_repo_stars_merged_pr", 1000)), NOW);
    expect(r.needsPrs).toBe(true);
    expect(r.mergedSince).toBeUndefined();
  });

  it("a PR condition whose pr filters lack mergedSince -> no date", () => {
    const r = searchWindow(oneTier(cond("merged_prs", 1, { excludeOwnRepos: true })), NOW);
    expect(r).toEqual({ needsPrs: true });
  });

  it("empty rule (no tiers) -> needsPrs false", () => {
    expect(searchWindow({ version: 1, tiers: [] }, NOW)).toEqual({ needsPrs: false });
  });
});

describe("searchWindow: date resolution", () => {
  it("a single year_start condition resolves to Jan 1 of now's UTC year", () => {
    const r = searchWindow(oneTier(cond("merged_prs", 1, { mergedSince: "year_start" })), NOW);
    expect(r).toEqual({ needsPrs: true, mergedSince: "2026-01-01" });
  });

  it("a single explicit date is returned as given", () => {
    const r = searchWindow(oneTier(cond("max_repo_stars_merged_pr", 1000, { mergedSince: "2025-03-10" })), NOW);
    expect(r).toEqual({ needsPrs: true, mergedSince: "2025-03-10" });
  });

  it("mixed: one PR condition with a date and one without -> no date", () => {
    const r = searchWindow(
      rule([cond("max_repo_stars_merged_pr", 1000, { mergedSince: "year_start" })], [cond("merged_prs", 1)]),
      NOW,
    );
    expect(r.needsPrs).toBe(true);
    expect(r.mergedSince).toBeUndefined();
  });

  it("mixed inside one tier: dated and undated PR conditions -> no date", () => {
    const r = searchWindow(
      oneTier([cond("merged_prs", 1, { mergedSince: "2025-01-01" }), cond("max_repo_stars_merged_pr", 10)]),
      NOW,
    );
    expect(r.mergedSince).toBeUndefined();
    expect(r.needsPrs).toBe(true);
  });

  it("earliest of several explicit dates wins, whatever the order", () => {
    const a = cond("merged_prs", 1, { mergedSince: "2025-06-01" });
    const b = cond("merged_prs", 2, { mergedSince: "2024-12-31" });
    const c = cond("max_repo_stars_merged_pr", 5, { mergedSince: "2025-01-15" });
    for (const r of [rule([a], [b], [c]), rule([c], [a], [b]), rule([b], [c], [a])]) {
      expect(searchWindow(r, NOW)).toEqual({ needsPrs: true, mergedSince: "2024-12-31" });
    }
  });

  it("year_start competes with explicit dates: earlier explicit date wins", () => {
    const r = rule(
      [cond("merged_prs", 1, { mergedSince: "year_start" })],
      [cond("merged_prs", 2, { mergedSince: "2025-09-09" })],
    );
    expect(searchWindow(r, NOW)).toEqual({ needsPrs: true, mergedSince: "2025-09-09" });
  });

  it("year_start competes with explicit dates: earlier year_start wins", () => {
    const r = rule(
      [cond("merged_prs", 1, { mergedSince: "year_start" })],
      [cond("merged_prs", 2, { mergedSince: "2026-03-01" })],
    );
    expect(searchWindow(r, NOW)).toEqual({ needsPrs: true, mergedSince: "2026-01-01" });
  });

  it("non-PR conditions do not affect the date", () => {
    const r = oneTier([
      cond("account_age_days", 1095),
      cond("merged_prs", 1, { mergedSince: "2025-05-05" }),
      cond("followers", 3),
    ]);
    expect(searchWindow(r, NOW)).toEqual({ needsPrs: true, mergedSince: "2025-05-05" });
  });
});

describe("searchWindow: year_start at different instants (UTC year)", () => {
  const r = oneTier(cond("merged_prs", 1, { mergedSince: "year_start" }));

  it.each([
    ["2026-01-01T00:00:00.000Z", "2026-01-01"], // boundary instant, new year
    ["2025-12-31T23:59:59.999Z", "2025-01-01"], // one ms before
    ["2026-12-31T23:59:59.999Z", "2026-01-01"], // last ms of the year
    ["2027-01-01T00:00:00.000Z", "2027-01-01"],
    ["2024-02-29T12:00:00.000Z", "2024-01-01"], // leap day
    ["2030-07-04T00:00:00.000Z", "2030-01-01"],
  ])("now=%s -> %s", (nowIso, expected) => {
    expect(searchWindow(r, new Date(nowIso))).toEqual({ needsPrs: true, mergedSince: expected });
  });

  it("uses the UTC year even when the local-offset time is still the previous year", () => {
    // 23:30 on Dec 31 at UTC-5 is 04:30 on Jan 1 UTC.
    expect(searchWindow(r, new Date("2025-12-31T23:30:00-05:00")).mergedSince).toBe("2026-01-01");
    // 00:30 on Jan 1 at UTC+2 is 22:30 on Dec 31 UTC.
    expect(searchWindow(r, new Date("2026-01-01T00:30:00+02:00")).mergedSince).toBe("2025-01-01");
  });

  it("returns a YYYY-MM-DD string", () => {
    expect(searchWindow(r, NOW).mergedSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
