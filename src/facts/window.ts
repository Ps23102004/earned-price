// Which merged PRs a rule needs fetched. Pure: the clock is an argument.

import { PR_FIELDS } from "../rules/types";
import type { Rule } from "../rules/types";

export function searchWindow(rule: Rule, now: Date): { needsPrs: boolean; mergedSince?: string } {
  const prConditions = rule.tiers.flatMap((t) => t.conditions).filter((c) => PR_FIELDS.includes(c.field));
  if (prConditions.length === 0) return { needsPrs: false };
  // One unbounded PR condition means the fetch cannot have a date qualifier at all.
  if (prConditions.some((c) => c.pr?.mergedSince === undefined)) return { needsPrs: true };
  const dates = prConditions.map((c) =>
    c.pr?.mergedSince === "year_start" ? `${now.getUTCFullYear()}-01-01` : (c.pr?.mergedSince as string),
  );
  return { needsPrs: true, mergedSince: dates.sort()[0] }; // YYYY-MM-DD sorts chronologically
}
