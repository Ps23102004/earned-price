// Deterministic rule evaluation over a FactSnapshot. Pure: the clock is an argument or the snapshot.

import type { FactSnapshot, GithubSnapshot, MergedPr } from "../facts/types";
import type { Condition, ConditionResult, EvaluationResult, Field, PrFilters, Rule } from "./types";

const DAY_MS = 86_400_000;

function passesFilters(pr: MergedPr, f: PrFilters | undefined, user: GithubSnapshot["user"], now: Date): boolean {
  if (!f) return true;
  const mergedAt = Date.parse(pr.mergedAt);
  if (f.minRepoStars !== undefined && !(pr.repo.stars >= f.minRepoStars)) return false;
  if (f.minLinesChanged !== undefined && !(pr.additions + pr.deletions >= f.minLinesChanged)) return false;
  if (f.excludeOwnRepos && pr.repo.ownerIsAuthor !== false) return false;
  if (f.excludeForks && pr.repo.isFork !== false) return false;
  if (f.mergedSince !== undefined) {
    const since =
      f.mergedSince === "year_start"
        ? Date.UTC(now.getUTCFullYear(), 0, 1)
        : Date.parse(`${f.mergedSince}T00:00:00.000Z`);
    if (!(mergedAt >= since)) return false;
  }
  if (
    f.minAccountAgeDaysAtMerge !== undefined &&
    !(Math.floor((mergedAt - Date.parse(user.createdAt)) / DAY_MS) >= f.minAccountAgeDaysAtMerge)
  ) {
    return false;
  }
  return true;
}

function conditionResult(c: Condition, snapshot: FactSnapshot, now: Date): ConditionResult {
  let actual = 0;
  let evidence: string[] = [];
  if (snapshot.kind === "github") {
    const u = snapshot.user;
    const userEvidence = u.url !== undefined ? [u.url] : [];
    const field: Field = c.field;
    if (field === "merged_prs" || field === "max_repo_stars_merged_pr") {
      const passing = snapshot.mergedPrs.filter((p) => passesFilters(p, c.pr, u, now));
      if (field === "merged_prs") {
        actual = passing.length;
        evidence = passing.flatMap((p) => (p.url !== undefined ? [p.url] : [])).slice(0, 5);
      } else {
        actual = passing.reduce((m, p) => Math.max(m, p.repo.stars), 0);
        const top = passing.find((p) => p.repo.stars === actual);
        evidence = top?.url !== undefined ? [top.url] : [];
      }
    } else {
      evidence = userEvidence;
      if (field === "account_age_days") actual = Math.floor((now.getTime() - Date.parse(u.createdAt)) / DAY_MS);
      else if (field === "followers") actual = u.followers;
      else if (field === "public_repos") actual = u.publicRepos;
      else actual = u.commitContributionsLastYear;
    }
  }
  return {
    field: c.field,
    op: "gte",
    threshold: c.value,
    actual,
    passed: actual >= c.value,
    evidence,
    ...(c.pr ? { pr: c.pr } : {}),
  };
}

export function evaluate(rule: Rule, snapshot: FactSnapshot, now?: Date): EvaluationResult {
  const clock =
    now ??
    new Date(snapshot.kind === "github" && snapshot.recordedAt ? snapshot.recordedAt : snapshot.fetchedAt);
  const tiers = rule.tiers.map((t) => {
    const conditions = t.conditions.map((c) => conditionResult(c, snapshot, clock));
    return {
      tierId: t.id,
      label: t.label,
      discountPercent: t.discountPercent,
      passed: conditions.every((c) => c.passed),
      conditions,
    };
  });
  let best: (typeof tiers)[number] | undefined;
  for (const t of tiers) {
    if (t.passed && (!best || t.discountPercent > best.discountPercent)) best = t;
  }
  return { now: clock.toISOString(), tiers, ...(best ? { appliedTierId: best.tierId } : {}) };
}
