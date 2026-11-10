// Build-time check on the recorded sample files: shape, anonymity, and that each still earns its label.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/rules/evaluate";
import { DEFAULT_RULE, LOOSE_RULE } from "../src/rules/presets";
import type { GithubSnapshot } from "../src/facts/types";

const NAMES = ["qualifies", "nearly", "loophole"] as const;
const load = (n: string): GithubSnapshot => JSON.parse(readFileSync(new URL(`../data/samples/${n}.json`, import.meta.url), "utf8"));
const applied = (rule: typeof LOOSE_RULE, s: GithubSnapshot) => evaluate(rule, s, new Date(s.recordedAt as string)).appliedTierId;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const BUCKETS = new Set([0, 2, 6, 30, 125, 600, 3000, 12500, 60000, 100000]);

describe.each(NAMES)("sample %s", (name) => {
  const s = load(name);

  it("has the GithubSnapshot shape", () => {
    expect(s.version).toBe(1);
    expect(s.kind).toBe("github");
    expect(s.source).toBe("sample");
    expect(s.label).toBe(`sample-${name}`);
    expect(s.recordedAt).toMatch(ISO);
    expect(s.fetchedAt).toMatch(ISO);
    expect(typeof s.truncated).toBe("boolean");
    expect(s.user.createdAt).toMatch(ISO);
    for (const k of ["followers", "publicRepos", "commitContributionsLastYear"] as const) expect(BUCKETS.has(s.user[k])).toBe(true);
    expect(s.mergedPrs.length).toBeGreaterThan(0);
    for (const p of s.mergedPrs) {
      expect(p.mergedAt).toMatch(/^\d{4}-\d{2}-15T00:00:00\.000Z$/);
      for (const n of [p.additions, p.deletions, p.changedFiles, p.repo.stars]) expect(BUCKETS.has(n)).toBe(true);
      expect(typeof p.repo.ownerIsAuthor).toBe("boolean");
      expect(typeof p.repo.isFork).toBe("boolean");
    }
  });

  it("contains no login, url or number fields anywhere", () => {
    const raw = readFileSync(new URL(`../data/samples/${name}.json`, import.meta.url), "utf8");
    expect(raw).not.toMatch(/"(login|ownerLogin|url|number)"/i);
    expect(raw).not.toMatch(/https?:\/\//);
    if (name === "loophole") expect(raw).not.toContain("nameWithOwner");
  });
});

describe("sample labels (clock frozen at recordedAt)", () => {
  it("qualifies: the 50% tier applies under the default rule", () => {
    expect(applied(DEFAULT_RULE, load("qualifies"))).toBe("t50");
  });

  it("nearly: the default rule gives a smaller tier but not the 50% one", () => {
    const s = load("nearly");
    expect(["t20", "t10"]).toContain(applied(DEFAULT_RULE, s));
    const t50 = evaluate(DEFAULT_RULE, s, new Date(s.recordedAt as string)).tiers[0].conditions[0];
    expect(t50.passed).toBe(false);
  });

  it("loophole: the loose rule gives 50%, the default rule does not", () => {
    const s = load("loophole");
    expect(applied(LOOSE_RULE, s)).toBe("t50");
    expect(applied(DEFAULT_RULE, s)).not.toBe("t50");
  });
});
