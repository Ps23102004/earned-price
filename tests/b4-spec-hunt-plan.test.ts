import { describe, expect, it } from "vitest";
import { acceptTightening, parseStrategies, spiritHolds, tighteningFor } from "../src/ai/hunt-plan";
import type { GithubSnapshot, MergedPr } from "../src/facts/types";
import { LOOSE_RULE } from "../src/rules/presets";
import type { Rule } from "../src/rules/types";

// Written from docs/specs/B4-merchant-compiler-hunt.md, not from the implementation.

const NOW = new Date("2026-11-10T00:00:00Z");

const pr = (over: Partial<MergedPr> = {}, repo: Partial<MergedPr["repo"]> = {}): MergedPr => ({
  mergedAt: "2026-10-20T00:00:00Z",
  additions: 40,
  deletions: 10,
  changedFiles: 2,
  repo: { stars: 5000, ownerIsAuthor: false, ownerType: "Organization", isFork: false, ...repo },
  ...over,
});

const snap = (createdAt: string, prs: MergedPr[]): GithubSnapshot => ({
  version: 1,
  kind: "github",
  source: "sample",
  fetchedAt: NOW.toISOString(),
  recordedAt: NOW.toISOString(),
  user: { createdAt, followers: 1, publicRepos: 1, commitContributionsLastYear: 1 },
  mergedPrs: prs,
  truncated: false,
});

const top = LOOSE_RULE.tiers[0]; // 50%, PR into a 1,000-star repo this year
const any = LOOSE_RULE.tiers[1]; // 20%, any merged PR
const age = LOOSE_RULE.tiers[2]; // 10%, account older than 1,095 days

describe("parseStrategies", () => {
  const good = { spiritCheck: "tiny_pr", title: "Typo fix", why: "A one line change qualifies", tierId: top.id };
  it("keeps valid entries and at most 4", () => {
    const list = Array.from({ length: 6 }, () => good);
    expect(parseStrategies(list, LOOSE_RULE)).toHaveLength(4);
  });
  it("drops unknown spiritCheck, unknown tierId and missing text", () => {
    const out = parseStrategies(
      [{ ...good, spiritCheck: "lie" }, { ...good, tierId: "nope" }, { ...good, why: "" }, { spiritCheck: "tiny_pr", tierId: top.id }, good],
      LOOSE_RULE,
    );
    expect(out).toHaveLength(1);
  });
  it("returns nothing for non-arrays", () => {
    expect(parseStrategies("x", LOOSE_RULE)).toEqual([]);
    expect(parseStrategies(null, LOOSE_RULE)).toEqual([]);
  });
  it("sanitises title and why to 120 chars of plain text", () => {
    const [s] = parseStrategies([{ ...good, title: "<script>" + "a".repeat(300), why: "ok {x} `y`" }], LOOSE_RULE);
    expect(s.title.length).toBeLessThanOrEqual(120);
    expect(s.title).not.toMatch(/[<>{}`]/);
    expect(s.why).not.toMatch(/[<>{}`]/);
  });
});

describe("spiritHolds", () => {
  it("tiny_pr: a qualifying PR of at most 2 changed lines", () => {
    expect(spiritHolds("tiny_pr", snap("2015-01-01T00:00:00Z", [pr({ additions: 1, deletions: 1 })]), top, NOW)).toBe(true);
    expect(spiritHolds("tiny_pr", snap("2015-01-01T00:00:00Z", [pr({ additions: 2, deletions: 1 })]), top, NOW)).toBe(false);
  });
  it("own_repo and fork_repo read the repo flags", () => {
    const own = snap("2015-01-01T00:00:00Z", [pr({}, { ownerIsAuthor: true })]);
    const fork = snap("2015-01-01T00:00:00Z", [pr({}, { isFork: true })]);
    expect(spiritHolds("own_repo", own, any, NOW)).toBe(true);
    expect(spiritHolds("own_repo", fork, any, NOW)).toBe(false);
    expect(spiritHolds("fork_repo", fork, any, NOW)).toBe(true);
    expect(spiritHolds("fork_repo", own, any, NOW)).toBe(false);
  });
  it("young_account: PR merged within 30 days of account creation", () => {
    expect(spiritHolds("young_account", snap("2026-10-10T00:00:00Z", [pr()]), any, NOW)).toBe(true);
    expect(spiritHolds("young_account", snap("2020-01-01T00:00:00Z", [pr()]), any, NOW)).toBe(false);
  });
  it("only PRs that make the tier pass count", () => {
    // 100 stars does not satisfy the 1,000-star tier, so its tiny PR is not a witness for that tier.
    const s = snap("2015-01-01T00:00:00Z", [pr({ additions: 1, deletions: 0 }, { stars: 100 })]);
    expect(spiritHolds("tiny_pr", s, top, NOW)).toBe(false);
  });
});

describe("tighteningFor", () => {
  const find = (r: Rule, id: string) => r.tiers.find((t) => t.id === id)!;
  it("never changes percents and never mutates its input", () => {
    const before = JSON.stringify(LOOSE_RULE);
    const next = tighteningFor("own_repo", LOOSE_RULE, any.id);
    expect(next.tiers.map((t) => t.discountPercent)).toEqual(LOOSE_RULE.tiers.map((t) => t.discountPercent));
    expect(JSON.stringify(LOOSE_RULE)).toBe(before);
  });
  it("own_repo and fork_repo set the exclude flags", () => {
    expect(find(tighteningFor("own_repo", LOOSE_RULE, any.id), any.id).conditions[0].pr?.excludeOwnRepos).toBe(true);
    expect(find(tighteningFor("fork_repo", LOOSE_RULE, any.id), any.id).conditions[0].pr?.excludeForks).toBe(true);
  });
  it("tiny_pr sets minLinesChanged to at least 10", () => {
    expect(find(tighteningFor("tiny_pr", LOOSE_RULE, top.id), top.id).conditions[0].pr?.minLinesChanged).toBeGreaterThanOrEqual(10);
  });
  it("young_account adds 30 days at merge on PR conditions", () => {
    expect(find(tighteningFor("young_account", LOOSE_RULE, top.id), top.id).conditions[0].pr?.minAccountAgeDaysAtMerge).toBe(30);
  });
  it("young_account on an age-only tier keeps the threshold at least 30", () => {
    const next = find(tighteningFor("young_account", LOOSE_RULE, age.id), age.id);
    const ageCond = next.conditions.find((c) => c.field === "account_age_days");
    expect(ageCond?.value).toBeGreaterThanOrEqual(30);
  });
});

describe("acceptTightening", () => {
  const clock = () => NOW;
  const tiny = snap("2015-01-01T00:00:00Z", [pr({ additions: 1, deletions: 0 }, { ownerIsAuthor: true })]);

  it("accepts a real tightening that removes the counterexample", () => {
    const next = tighteningFor("own_repo", LOOSE_RULE, any.id);
    expect(acceptTightening(LOOSE_RULE, next, [tiny], any.id, clock)).toEqual({ ok: true, reasons: [] });
  });
  it("rejects when the counterexample still qualifies", () => {
    const next = tighteningFor("fork_repo", LOOSE_RULE, any.id); // example is not a fork, still earns the tier
    const r = acceptTightening(LOOSE_RULE, next, [tiny], any.id, clock);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/still earns/);
  });
  it("rejects a loosened rule", () => {
    const loose: Rule = JSON.parse(JSON.stringify(LOOSE_RULE));
    loose.tiers[1].conditions[0].value = 1; // unchanged value is fine; now loosen the age tier instead
    loose.tiers[2].conditions[0].value = 10;
    expect(acceptTightening(LOOSE_RULE, loose, [], any.id, clock).ok).toBe(false);
  });
  it("rejects a changed percent", () => {
    const next: Rule = JSON.parse(JSON.stringify(tighteningFor("own_repo", LOOSE_RULE, any.id)));
    next.tiers[1].discountPercent = 10;
    expect(acceptTightening(LOOSE_RULE, next, [tiny], any.id, clock).ok).toBe(false);
  });
});
