// Rule type over a fixed whitelist of public GitHub facts. Pure data, no I/O.

export const FIELDS = [
  "account_age_days",
  "followers",
  "public_repos",
  "commit_contributions_last_year",
  "merged_prs",
  "max_repo_stars_merged_pr",
] as const;

export type Field = (typeof FIELDS)[number];

/** Fields that are computed from merged pull requests and may carry `pr` filters. */
export const PR_FIELDS: readonly Field[] = ["merged_prs", "max_repo_stars_merged_pr"];

/** Inclusive upper bound for `Condition.value`, per field. Lower bound is always 1. */
export const FIELD_MAX: Record<Field, number> = {
  account_age_days: 15_000,
  followers: 100_000,
  public_repos: 100_000,
  commit_contributions_last_year: 100_000,
  merged_prs: 100_000,
  max_repo_stars_merged_pr: 10_000_000,
};

export type IsoDate = string; // YYYY-MM-DD
export type IsoDateTime = string; // full ISO 8601, UTC

export type PrFilters = {
  minRepoStars?: number;
  minLinesChanged?: number;
  excludeOwnRepos?: boolean;
  excludeForks?: boolean;
  mergedSince?: "year_start" | IsoDate;
  minAccountAgeDaysAtMerge?: number;
};

export type Condition = {
  field: Field;
  op: "gte";
  value: number;
  pr?: PrFilters;
};

export type Tier = {
  id: string;
  label: string;
  discountPercent: number;
  conditions: Condition[];
};

export type Rule = {
  version: 1;
  tiers: Tier[];
};

export type ValidationResult = { ok: true; rule: Rule } | { ok: false; errors: string[] };

export type ConditionResult = {
  field: Field;
  op: "gte";
  threshold: number;
  actual: number;
  passed: boolean;
  /** Public URLs of the facts that decided this condition (may be empty). */
  evidence: string[];
  pr?: PrFilters;
};

export type TierResult = {
  tierId: string;
  label: string;
  discountPercent: number;
  passed: boolean;
  conditions: ConditionResult[];
};

export type EvaluationResult = {
  /** The instant the rule was evaluated at, ISO 8601 UTC. */
  now: IsoDateTime;
  tiers: TierResult[];
  appliedTierId?: string;
};

export type PriceLine = {
  tierId: string;
  label: string;
  discountPercent: number;
  status: "applied" | "superseded" | "not_met";
  discountCents: number;
};

export type PriceResult = {
  listCents: number;
  discountCents: number;
  earnedCents: number;
  appliedTierId?: string;
  lines: PriceLine[];
};
