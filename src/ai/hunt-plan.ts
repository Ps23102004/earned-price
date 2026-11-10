// Loophole-hunt logic that code owns: which "spirit" checks exist, whether an account breaks one, the
// deterministic tightening that closes it, and whether that tightening is acceptable. Pure.

import type { GithubSnapshot, MergedPr } from "../facts/types";
import { qualifyingPrs, evaluate } from "../rules/evaluate";
import { PR_FIELDS } from "../rules/types";
import type { Rule, Tier } from "../rules/types";
import { isNotLooser, validateRule } from "../rules/validate";

export const SPIRIT_CHECKS = ["young_account", "tiny_pr", "own_repo", "fork_repo"] as const;
export type SpiritCheck = (typeof SPIRIT_CHECKS)[number];
export type Strategy = { spiritCheck: SpiritCheck; title: string; why: string; tierId: string };

const DAY_MS = 86_400_000;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const clean = (v: unknown): string =>
  typeof v !== "string"
    ? ""
    : Array.from(v.replace(/\s+/gu, " ").replace(/[^\p{L}\p{N} .,;:'()%-]/gu, "").trim()).slice(0, 120).join("").trim();

/** Model output to at most four strategies code understands; anything else is dropped. */
export function parseStrategies(m: unknown, rule: Rule): Strategy[] {
  const list = Array.isArray(m) ? m : isObj(m) && Array.isArray(m.strategies) ? m.strategies : [];
  const out: Strategy[] = [];
  for (const e of list) {
    if (out.length >= 4) break;
    if (!isObj(e)) continue;
    const { spiritCheck, tierId } = e;
    if (!(SPIRIT_CHECKS as readonly unknown[]).includes(spiritCheck)) continue;
    if (typeof tierId !== "string" || !rule.tiers.some((t) => t.id === tierId)) continue;
    const title = clean(e.title);
    const why = clean(e.why);
    if (title === "" || why === "") continue;
    out.push({ spiritCheck: spiritCheck as SpiritCheck, title, why, tierId });
  }
  return out;
}

const time = (iso: string): number => Date.parse(iso);

/** PRs that make the tier's PR conditions pass. A condition that does not pass contributes none. */
function qualifying(tier: Tier, s: GithubSnapshot, now: Date): MergedPr[] {
  const out: MergedPr[] = [];
  for (const c of tier.conditions) {
    if (!PR_FIELDS.includes(c.field)) continue;
    const prs = qualifyingPrs(c, s, now);
    if (c.field === "merged_prs") {
      if (prs.length >= c.value) out.push(...prs);
    } else {
      out.push(...prs.filter((p) => p.repo.stars >= c.value));
    }
  }
  return out;
}

/** Why the spirit is broken: the offending PR, `{}` when the evidence is the account itself, or undefined. */
export function spiritWitness(check: SpiritCheck, s: GithubSnapshot, tier: Tier, now: Date): { pr?: MergedPr } | undefined {
  const hasPrCondition = tier.conditions.some((c) => PR_FIELDS.includes(c.field));
  const prs = qualifying(tier, s, now);
  if (check === "young_account") {
    const pr = prs.find((p) => Math.floor((time(p.mergedAt) - time(s.user.createdAt)) / DAY_MS) < 30);
    if (pr) return { pr };
    const age = Math.floor((now.getTime() - time(s.user.createdAt)) / DAY_MS);
    const ageCond = tier.conditions.find((c) => c.field === "account_age_days");
    return ageCond && age < 30 && age >= ageCond.value ? {} : undefined;
  }
  if (!hasPrCondition) return undefined;
  const pr = prs.find((p) =>
    check === "tiny_pr" ? p.additions + p.deletions <= 2 : check === "own_repo" ? p.repo.ownerIsAuthor === true : p.repo.isFork === true,
  );
  return pr ? { pr } : undefined;
}

export function spiritHolds(check: SpiritCheck, s: GithubSnapshot, tier: Tier, now: Date): boolean {
  return spiritWitness(check, s, tier, now) !== undefined;
}

/** The fix for a spirit check. Only adds restrictions; never touches a percent. */
export function tighteningFor(check: SpiritCheck, rule: Rule, tierId: string): Rule {
  const next = structuredClone(rule);
  const tier = next.tiers.find((t) => t.id === tierId);
  if (!tier) return next;
  const prConditions = tier.conditions.filter((c) => PR_FIELDS.includes(c.field));
  const raise = (key: "minAccountAgeDaysAtMerge" | "minLinesChanged", to: number) => {
    for (const c of prConditions) c.pr = { ...c.pr, [key]: Math.max(c.pr?.[key] ?? 0, to) };
  };
  if (check === "young_account") {
    if (prConditions.length > 0) raise("minAccountAgeDaysAtMerge", 30);
    else if (tier.conditions.length < 3) tier.conditions.push({ field: "account_age_days", op: "gte", value: 30 });
    else for (const c of tier.conditions) if (c.field === "account_age_days") c.value = Math.max(c.value, 30);
  } else if (check === "tiny_pr") raise("minLinesChanged", 10);
  else if (check === "own_repo") for (const c of prConditions) c.pr = { ...c.pr, excludeOwnRepos: true };
  else for (const c of prConditions) c.pr = { ...c.pr, excludeForks: true };
  return next;
}

export function acceptTightening(
  oldRule: Rule,
  newRule: Rule,
  counterexamples: GithubSnapshot[],
  tierId: string,
  now: (s: GithubSnapshot) => Date,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const valid = validateRule(newRule);
  if (!valid.ok) reasons.push("the tightened rule is not a valid rule");
  if (!isNotLooser(oldRule, newRule)) reasons.push("the tightened rule is not at least as strict as the current one");
  const percents = (r: Rule) => r.tiers.map((t) => t.discountPercent).join(",");
  if (percents(oldRule) !== percents(newRule)) reasons.push("a discount percent changed");
  if (!newRule.tiers.some((t) => t.id === tierId)) {
    reasons.push("the targeted tier is missing");
  } else {
    counterexamples.forEach((s, i) => {
      const r = evaluate(newRule, s, now(s)).tiers.find((t) => t.tierId === tierId);
      if (r?.passed) reasons.push(`example ${i + 1} still earns the tier under the tightened rule`);
    });
  }
  return { ok: reasons.length === 0, reasons };
}
