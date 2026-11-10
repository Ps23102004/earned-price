// Plain-English read-back of a rule. Pure.

import type { Condition, PrFilters, Rule } from "./types";

const n = (x: number) => x.toLocaleString("en-US");

function suffix(f: PrFilters | undefined): string {
  if (!f) return "";
  const parts: string[] = [];
  if (f.minRepoStars !== undefined) parts.push(`into repositories with at least ${n(f.minRepoStars)} stars`);
  if (f.minLinesChanged !== undefined) parts.push(`changing at least ${n(f.minLinesChanged)} lines`);
  if (f.excludeOwnRepos) parts.push("not into the author's own repositories");
  if (f.excludeForks) parts.push("not into forks");
  if (f.mergedSince !== undefined) {
    parts.push(f.mergedSince === "year_start" ? "merged this calendar year" : `merged on or after ${f.mergedSince}`);
  }
  if (f.minAccountAgeDaysAtMerge !== undefined) {
    parts.push(`when the account was at least ${n(f.minAccountAgeDaysAtMerge)} days old`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function phrase(c: Condition): string {
  const v = n(c.value);
  switch (c.field) {
    case "account_age_days":
      return `the GitHub account is at least ${v} days old`;
    case "followers":
      return `the account has at least ${v} followers`;
    case "public_repos":
      return `the account owns at least ${v} public repositories`;
    case "commit_contributions_last_year":
      return `the account made at least ${v} commits in the last year`;
    case "merged_prs":
      return `the account has at least ${v} merged pull request${c.value === 1 ? "" : "s"}${suffix(c.pr)}`;
    case "max_repo_stars_merged_pr":
      return `the account has a merged pull request into a repository with at least ${v} stars${suffix(c.pr)}`;
  }
}

export function readback(rule: Rule): string {
  const lines = rule.tiers.map(
    (t) => `${t.discountPercent}% off (${t.label}) if ${t.conditions.map(phrase).join(" and ")}.`,
  );
  lines.push("Only the single best matching tier applies.");
  return lines.join("\n");
}
