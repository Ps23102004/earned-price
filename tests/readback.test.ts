import { describe, expect, it } from "vitest";
import { readback } from "../src/rules/readback";
import type { Condition, Rule } from "../src/rules/types";
import { at, cond, makeExampleRule, oneTier } from "./helpers";

const FINAL = "Only the single best matching tier applies.";

/** Single tier "L" at 10%, returns the first (tier) line of the read-back. */
function tierLine(c: Condition | Condition[], pct = 10, label = "L"): string {
  const rule: Rule = {
    version: 1,
    tiers: [{ id: "t1", label, discountPercent: pct, conditions: Array.isArray(c) ? c : [c] }],
  };
  return at(readback(rule).split("\n"), 0);
}

describe("readback: spec example", () => {
  const rule: Rule = {
    version: 1,
    tiers: [
      {
        id: "t1",
        label: "core contributor",
        discountPercent: 50,
        conditions: [{ field: "max_repo_stars_merged_pr", op: "gte", value: 1000, pr: { mergedSince: "year_start" } }],
      },
    ],
  };
  const line =
    "50% off (core contributor) if the account has a merged pull request into a repository with at least 1,000 stars (merged this calendar year).";

  it("renders the exact tier line", () => {
    expect(at(readback(rule).split("\n"), 0)).toBe(line);
  });

  it("is the tier line, a newline, then the final line", () => {
    expect(readback(rule)).toBe(`${line}\n${FINAL}`);
  });
});

describe("readback: structure", () => {
  it("ends with the final line", () => {
    const lines = readback(makeExampleRule()).split("\n");
    expect(lines.at(-1)).toBe(FINAL);
  });

  it("has one line per tier plus the final line, joined by newlines", () => {
    const rule = makeExampleRule();
    const lines = readback(rule).split("\n");
    expect(lines).toHaveLength(rule.tiers.length + 1);
    expect(lines[0]).toMatch(/^50% off \(core contributor\) if /);
    expect(lines[1]).toBe("20% off (contributor) if the account has at least 1 merged pull request.");
    expect(lines[2]).toBe("10% off (veteran) if the GitHub account is at least 1,095 days old.");
  });

  it("every tier line ends with a period", () => {
    const lines = readback(makeExampleRule()).split("\n");
    for (const l of lines) expect(l.endsWith(".")).toBe(true);
  });

  it("joins multiple conditions with ' and '", () => {
    expect(tierLine([cond("followers", 10), cond("public_repos", 3)], 25, "pair")).toBe(
      "25% off (pair) if the account has at least 10 followers and the account owns at least 3 public repositories.",
    );
  });

  it("joins three conditions with ' and ' between each", () => {
    expect(tierLine([cond("followers", 1), cond("public_repos", 2), cond("account_age_days", 3)])).toBe(
      "10% off (L) if the account has at least 1 follower and the account owns at least 2 public repositories and the GitHub account is at least 3 days old.",
    );
  });
});

describe("readback: field phrases", () => {
  it("account_age_days", () => {
    expect(tierLine(cond("account_age_days", 365))).toBe("10% off (L) if the GitHub account is at least 365 days old.");
  });
  it("followers", () => {
    expect(tierLine(cond("followers", 50))).toBe("10% off (L) if the account has at least 50 followers.");
  });
  it("public_repos", () => {
    expect(tierLine(cond("public_repos", 7))).toBe("10% off (L) if the account owns at least 7 public repositories.");
  });
  it("commit_contributions_last_year", () => {
    expect(tierLine(cond("commit_contributions_last_year", 200))).toBe(
      "10% off (L) if the account made at least 200 commits in the last year.",
    );
  });
  it("merged_prs", () => {
    expect(tierLine(cond("merged_prs", 5))).toBe("10% off (L) if the account has at least 5 merged pull requests.");
  });
  it("max_repo_stars_merged_pr", () => {
    expect(tierLine(cond("max_repo_stars_merged_pr", 500))).toBe(
      "10% off (L) if the account has a merged pull request into a repository with at least 500 stars.",
    );
  });
});

describe("readback: merged_prs pluralisation", () => {
  it("N = 1 is singular", () => {
    expect(tierLine(cond("merged_prs", 1))).toBe("10% off (L) if the account has at least 1 merged pull request.");
  });
  it("N = 2 is plural", () => {
    expect(tierLine(cond("merged_prs", 2))).toBe("10% off (L) if the account has at least 2 merged pull requests.");
  });
  it("N = 1 with a filter suffix is still singular", () => {
    expect(tierLine(cond("merged_prs", 1, { excludeForks: true }))).toBe(
      "10% off (L) if the account has at least 1 merged pull request (not into forks).",
    );
  });
  it("N = 11 is plural", () => {
    expect(tierLine(cond("merged_prs", 11))).toContain("at least 11 merged pull requests.");
  });
});

describe("readback: number formatting (en-US grouping)", () => {
  it("formats 1,000 in the field value", () => {
    expect(tierLine(cond("followers", 1000))).toBe("10% off (L) if the account has at least 1,000 followers.");
  });
  it("formats merged_prs, account age, and stars", () => {
    expect(tierLine(cond("merged_prs", 1000))).toContain("at least 1,000 merged pull requests");
    expect(tierLine(cond("account_age_days", 1095))).toContain("at least 1,095 days old");
    expect(tierLine(cond("max_repo_stars_merged_pr", 10_000_000))).toContain("at least 10,000,000 stars");
  });
  it("formats numbers inside filters", () => {
    const l = tierLine(
      cond("merged_prs", 1, { minRepoStars: 10_000, minLinesChanged: 1_000_000, minAccountAgeDaysAtMerge: 1_500 }),
    );
    expect(l).toContain("at least 10,000 stars");
    expect(l).toContain("at least 1,000,000 lines");
    expect(l).toContain("at least 1,500 days old");
  });
  it("leaves numbers under 1000 ungrouped", () => {
    expect(tierLine(cond("followers", 999))).toContain("at least 999 followers");
  });
});

describe("readback: filter suffix", () => {
  it("is empty without filters", () => {
    expect(tierLine(cond("merged_prs", 3))).toBe("10% off (L) if the account has at least 3 merged pull requests.");
  });

  it("is empty for an empty pr object", () => {
    expect(tierLine(cond("merged_prs", 3, {}))).toBe("10% off (L) if the account has at least 3 merged pull requests.");
  });

  it("is empty when only false booleans are present", () => {
    expect(tierLine(cond("merged_prs", 3, { excludeOwnRepos: false, excludeForks: false }))).toBe(
      "10% off (L) if the account has at least 3 merged pull requests.",
    );
  });

  it("each filter in isolation", () => {
    const base = "10% off (L) if the account has at least 3 merged pull requests";
    expect(tierLine(cond("merged_prs", 3, { minRepoStars: 100 }))).toBe(`${base} (into repositories with at least 100 stars).`);
    expect(tierLine(cond("merged_prs", 3, { minLinesChanged: 50 }))).toBe(`${base} (changing at least 50 lines).`);
    expect(tierLine(cond("merged_prs", 3, { excludeOwnRepos: true }))).toBe(`${base} (not into the author's own repositories).`);
    expect(tierLine(cond("merged_prs", 3, { excludeForks: true }))).toBe(`${base} (not into forks).`);
    expect(tierLine(cond("merged_prs", 3, { mergedSince: "year_start" }))).toBe(`${base} (merged this calendar year).`);
    expect(tierLine(cond("merged_prs", 3, { mergedSince: "2026-02-01" }))).toBe(`${base} (merged on or after 2026-02-01).`);
    expect(tierLine(cond("merged_prs", 3, { minAccountAgeDaysAtMerge: 30 }))).toBe(
      `${base} (when the account was at least 30 days old).`,
    );
  });

  it("all filters, in the spec's fixed order whatever the key order", () => {
    // deliberately scrambled key order
    const pr = {
      minAccountAgeDaysAtMerge: 30,
      mergedSince: "year_start",
      excludeForks: true,
      excludeOwnRepos: true,
      minLinesChanged: 50,
      minRepoStars: 100,
    } as const;
    expect(tierLine(cond("merged_prs", 2, pr))).toBe(
      "10% off (L) if the account has at least 2 merged pull requests (into repositories with at least 100 stars, changing at least 50 lines, not into the author's own repositories, not into forks, merged this calendar year, when the account was at least 30 days old).",
    );
  });

  it("all filters with a dated mergedSince and a thousands separator", () => {
    const pr = {
      minRepoStars: 1000,
      minLinesChanged: 2000,
      excludeOwnRepos: true,
      excludeForks: true,
      mergedSince: "2025-03-04",
      minAccountAgeDaysAtMerge: 1095,
    } as const;
    expect(tierLine(cond("merged_prs", 2, pr))).toBe(
      "10% off (L) if the account has at least 2 merged pull requests (into repositories with at least 1,000 stars, changing at least 2,000 lines, not into the author's own repositories, not into forks, merged on or after 2025-03-04, when the account was at least 1,095 days old).",
    );
  });

  it("a subset keeps the relative order (skips absent parts)", () => {
    const pr = { excludeForks: true, minRepoStars: 10 } as const;
    expect(tierLine(cond("merged_prs", 2, pr))).toBe(
      "10% off (L) if the account has at least 2 merged pull requests (into repositories with at least 10 stars, not into forks).",
    );
  });

  it("applies to max_repo_stars_merged_pr too", () => {
    expect(tierLine(cond("max_repo_stars_merged_pr", 1000, { excludeForks: true, mergedSince: "year_start" }))).toBe(
      "10% off (L) if the account has a merged pull request into a repository with at least 1,000 stars (not into forks, merged this calendar year).",
    );
  });
});

describe("readback: multiple tiers", () => {
  it("joins tier lines with newlines, in rule order, then the final line", () => {
    const rule: Rule = {
      version: 1,
      tiers: [
        { id: "a", label: "first", discountPercent: 15, conditions: [cond("followers", 5)] },
        { id: "b", label: "second", discountPercent: 35, conditions: [cond("public_repos", 10)] },
        { id: "c", label: "third", discountPercent: 60, conditions: [cond("account_age_days", 2000)] },
      ],
    };
    expect(readback(rule)).toBe(
      [
        "15% off (first) if the account has at least 5 followers.",
        "35% off (second) if the account owns at least 10 public repositories.",
        "60% off (third) if the GitHub account is at least 2,000 days old.",
        FINAL,
      ].join("\n"),
    );
  });

  it("a one-tier rule has exactly two lines", () => {
    expect(readback(oneTier(cond("followers", 1), 20)).split("\n")).toHaveLength(2);
  });
});
