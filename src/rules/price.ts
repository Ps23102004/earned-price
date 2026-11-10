// Turns an EvaluationResult into a price. Pure integer math.

import type { EvaluationResult, PriceLine, PriceResult, Rule } from "./types";

export function price(rule: Rule, result: EvaluationResult, listCents: number): PriceResult {
  // Upper bound keeps listCents * 100 well inside the safe-integer range.
  if (!Number.isInteger(listCents) || listCents <= 0 || listCents > 100_000_000) {
    throw new Error(`listCents must be a positive integer, got ${listCents}`);
  }
  const percentOf = (id: string) => rule.tiers.find((t) => t.id === id)?.discountPercent;
  const applied = result.appliedTierId;
  let discountCents = 0;
  if (applied !== undefined) {
    const pct = percentOf(applied);
    if (pct === undefined) throw new Error(`applied tier "${applied}" is not in the rule`);
    discountCents = Math.floor((listCents * pct + 50) / 100);
  }
  const lines: PriceLine[] = result.tiers.map((t) => ({
    tierId: t.tierId,
    label: t.label,
    discountPercent: percentOf(t.tierId) ?? t.discountPercent,
    status: t.tierId === applied ? "applied" : t.passed ? "superseded" : "not_met",
    discountCents: t.tierId === applied ? discountCents : 0,
  }));
  return {
    listCents,
    discountCents,
    earnedCents: listCents - discountCents,
    ...(applied !== undefined ? { appliedTierId: applied } : {}),
    lines,
  };
}
