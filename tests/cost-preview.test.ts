import { describe, expect, it } from "vitest";
import type { GithubSnapshot } from "../src/facts/types";
import { costPreview } from "../src/rules/cost-preview";
import { DEFAULT_RULE, LOOSE_RULE } from "../src/rules/presets";

const AT = "2026-11-10T00:00:00.000Z";
const snap = (createdAt: string, prs: { stars: number }[] = []): GithubSnapshot => ({
  version: 1,
  kind: "github",
  source: "sample",
  fetchedAt: AT,
  recordedAt: AT,
  user: { createdAt, followers: 0, publicRepos: 1, commitContributionsLastYear: 0 },
  mergedPrs: prs.map((p) => ({
    mergedAt: "2026-10-15T00:00:00.000Z",
    additions: 50,
    deletions: 5,
    changedFiles: 2,
    repo: { stars: p.stars, ownerIsAuthor: false, ownerType: "Organization" as const, isFork: false },
  })),
  truncated: false,
});

describe("costPreview", () => {
  it("counts the best tier per account and averages the discount over the whole sample", () => {
    const accounts = [
      snap("2015-01-01T00:00:00Z", [{ stars: 5000 }]), // top tier (50%)
      snap("2025-06-01T00:00:00Z", [{ stars: 10 }]), // any merged PR (20%)
      snap("2015-01-01T00:00:00Z"), // old account (10%)
      snap("2026-09-01T00:00:00Z"), // nothing
    ];
    const p = costPreview(DEFAULT_RULE, accounts, AT);
    expect(p).toMatchObject({ n: 4, qualifying: 3, sharePercent: 75, averageDiscountPercent: 20 });
    expect(p.tiers.map((t) => t.count)).toEqual([1, 1, 1]);
    expect(p.summary).toContain("75%");
    expect(p.summary).toContain("2026-11-10");
  });
  it("is deterministic and never mutates the sample", () => {
    const accounts = [snap("2015-01-01T00:00:00Z", [{ stars: 5000 }])];
    const before = JSON.stringify(accounts);
    expect(costPreview(LOOSE_RULE, accounts, AT)).toEqual(costPreview(LOOSE_RULE, accounts, AT));
    expect(JSON.stringify(accounts)).toBe(before);
  });
  it("handles an empty sample without dividing by zero", () => {
    expect(costPreview(DEFAULT_RULE, [], AT)).toMatchObject({ n: 0, sharePercent: 0, averageDiscountPercent: 0 });
  });
});

describe("recorded sample population", () => {
  it("is anonymised and gives a sane preview under both named rules", async () => {
    const { SAMPLE_ACCOUNTS } = await import("../src/facts/sample-accounts");
    const text = JSON.stringify(SAMPLE_ACCOUNTS);
    expect(SAMPLE_ACCOUNTS.accounts.length).toBeGreaterThanOrEqual(30);
    expect(text).not.toMatch(/"(login|url|nameWithOwner|ownerLogin|number)"/);
    expect(text).not.toMatch(/github\.com/);
    const strict = costPreview(DEFAULT_RULE, SAMPLE_ACCOUNTS.accounts, SAMPLE_ACCOUNTS.recordedAt);
    const loose = costPreview(LOOSE_RULE, SAMPLE_ACCOUNTS.accounts, SAMPLE_ACCOUNTS.recordedAt);
    expect(strict.n).toBe(SAMPLE_ACCOUNTS.accounts.length);
    expect(loose.qualifying).toBeGreaterThanOrEqual(strict.qualifying); // closing loopholes never admits more accounts
    expect(loose.averageDiscountPercent).toBeGreaterThanOrEqual(strict.averageDiscountPercent);
  });
});

describe("giveaway estimate", () => {
  it("is the mean discount times the list price times 1,000, in whole cents", () => {
    const accounts = [snap("2015-01-01T00:00:00Z", [{ stars: 5000 }]), snap("2026-09-01T00:00:00Z")]; // 50% and nothing
    expect(costPreview(DEFAULT_RULE, accounts, AT, 4900).giveawayPer1000Cents).toBe(Math.round((50 * 4900 * 1000) / (100 * 2)));
    expect(costPreview(DEFAULT_RULE, [], AT).giveawayPer1000Cents).toBe(0);
  });
});
