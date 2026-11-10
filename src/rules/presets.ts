// The two rules the shop knows by name. Pure data.

import type { Rule } from "./types";

/** The merchant's sentence as typed: easy to game with own repositories and trivial pull requests. */
export const LOOSE_RULE: Rule = {
  version: 1,
  tiers: [
    {
      id: "t50",
      label: "OSS contributor",
      discountPercent: 50,
      conditions: [
        { field: "max_repo_stars_merged_pr", op: "gte", value: 1000, pr: { mergedSince: "year_start" } },
      ],
    },
    { id: "t20", label: "Any merged PR", discountPercent: 20, conditions: [{ field: "merged_prs", op: "gte", value: 1 }] },
    {
      id: "t10",
      label: "Veteran account",
      discountPercent: 10,
      conditions: [{ field: "account_age_days", op: "gte", value: 1095 }],
    },
  ],
};

/** What the shop publishes: the same tiers with the loopholes closed. */
export const DEFAULT_RULE: Rule = {
  version: 1,
  tiers: [
    {
      id: "t50",
      label: "OSS contributor",
      discountPercent: 50,
      conditions: [
        {
          field: "max_repo_stars_merged_pr",
          op: "gte",
          value: 1000,
          pr: { mergedSince: "year_start", excludeOwnRepos: true, excludeForks: true, minLinesChanged: 10 },
        },
      ],
    },
    {
      id: "t20",
      label: "Any merged PR",
      discountPercent: 20,
      conditions: [{ field: "merged_prs", op: "gte", value: 1, pr: { excludeOwnRepos: true, minLinesChanged: 10 } }],
    },
    {
      id: "t10",
      label: "Veteran account",
      discountPercent: 10,
      conditions: [
        { field: "account_age_days", op: "gte", value: 1095 },
        { field: "public_repos", op: "gte", value: 1 },
      ],
    },
  ],
};

export const PRESETS: Record<"loose" | "default", Rule> = { loose: LOOSE_RULE, default: DEFAULT_RULE };
