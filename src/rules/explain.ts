// Per-tier, per-condition breakdown of an evaluation for display. Pure, no clock.

import type { EvaluationResult, Field, PriceResult, Rule } from "./types";
import { phrase } from "./readback";

export type ExplainCondition = {
  text: string;
  actual: number;
  threshold: number;
  passed: boolean;
  missing?: string;
  evidence: string[];
};
export type ExplainRow = {
  tierId: string;
  label: string;
  discountPercent: number;
  status: "applied" | "superseded" | "not_met";
  conditions: ExplainCondition[];
};
export type ExplainView = {
  rows: ExplainRow[];
  listCents: number;
  earnedCents: number;
  discountCents: number;
  appliedTierId?: string;
  evaluatedAt: string;
};

function missing(field: Field, actual: number, threshold: number): string {
  if (field === "account_age_days") return `needs ${threshold - actual} more days`;
  if (field === "max_repo_stars_merged_pr") {
    return actual === 0 ? `needs a repository with at least ${threshold} stars` : `needs ${threshold - actual} more stars`;
  }
  return `needs ${threshold - actual} more`;
}

export function explain(rule: Rule, result: EvaluationResult, p: PriceResult): ExplainView {
  const rows = result.tiers.map((t): ExplainRow => ({
    tierId: t.tierId,
    label: t.label,
    discountPercent: t.discountPercent,
    status: p.lines.find((l) => l.tierId === t.tierId)?.status ?? "not_met",
    conditions: t.conditions.map((c, j) => ({
      text: phrase(rule.tiers.find((rt) => rt.id === t.tierId)?.conditions[j] ?? { field: c.field, op: "gte", value: c.threshold, pr: c.pr }),
      actual: c.actual,
      threshold: c.threshold,
      passed: c.passed,
      ...(c.passed ? {} : { missing: missing(c.field, c.actual, c.threshold) }),
      evidence: c.evidence,
    })),
  }));
  return {
    rows,
    listCents: p.listCents,
    earnedCents: p.earnedCents,
    discountCents: p.discountCents,
    ...(p.appliedTierId !== undefined ? { appliedTierId: p.appliedTierId } : {}),
    evaluatedAt: result.now,
  };
}
