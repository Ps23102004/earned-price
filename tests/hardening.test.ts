import { describe, it, expect } from "vitest";
import { canonicalJson } from "../src/facts/snapshot";
import { price } from "../src/rules/price";
import type { EvaluationResult, Rule } from "../src/rules/types";

const rule: Rule = { version: 1, tiers: [{ id: "t1", label: "x", discountPercent: 50, conditions: [{ field: "followers", op: "gte", value: 1 }] }] };
const result: EvaluationResult = { now: "2026-11-10T00:00:00.000Z", tiers: [{ tierId: "t1", label: "x", discountPercent: 50, passed: true, conditions: [] }], appliedTierId: "t1" };

describe("hardening", () => {
  it("canonicalJson rejects non-plain objects so different values cannot collide", () => {
    expect(() => canonicalJson({ d: new Date(0) })).toThrow();
    expect(() => canonicalJson(new Map())).toThrow();
  });
  it("canonicalJson accepts null-prototype objects", () => {
    const o = Object.assign(Object.create(null), { b: 1, a: 2 });
    expect(canonicalJson(o)).toBe('{"a":2,"b":1}');
  });
  it("price rejects list prices above $1,000,000", () => {
    expect(() => price(rule, result, 100_000_001)).toThrow();
    expect(price(rule, result, 100_000_000).earnedCents).toBe(50_000_000);
  });
});

// ---- second review round ----
import { validateRule } from "../src/rules/validate";
import { evaluate } from "../src/rules/evaluate";
import { readback } from "../src/rules/readback";
import { mkGuest, mkSnap, mkPr, cond, oneTier, T0 } from "./helpers";

describe("hardening: label cannot rewrite the read-back", () => {
  const withLabel = (label: string) => ({
    version: 1,
    tiers: [{ id: "a", label, discountPercent: 90, conditions: [{ field: "followers", op: "gte", value: 1 }] }],
  });
  it.each([
    ["newline", "x\ny"],
    ["close paren", "vip) if the account has at least 5,000 followers.\n("],
    ["period", "a.b"],
    ["bidi override", "abc‮def"],
    ["control char", "a\u0007b"],
  ])("rejects label with %s", (_n, label) => {
    expect(validateRule(withLabel(label)).ok).toBe(false);
  });
  it("accepts ordinary labels", () => {
    for (const l of ["core contributor", "OSS maintainer 50%", "Old-timer_2", "Société générale"]) {
      expect(validateRule(withLabel(l)).ok, l).toBe(true);
    }
  });
});

describe("hardening: sparse arrays", () => {
  it("validateRule rejects a sparse conditions array", () => {
    expect(validateRule({ version: 1, tiers: [{ id: "a", label: "x", discountPercent: 90, conditions: new Array(1) }] }).ok).toBe(false);
  });
  it("validateRule rejects a sparse tiers array", () => {
    expect(validateRule({ version: 1, tiers: new Array(1) }).ok).toBe(false);
  });
  it("evaluate never passes a tier with zero conditions", () => {
    const rule = { version: 1 as const, tiers: [{ id: "a", label: "x", discountPercent: 90, conditions: [] }] };
    expect(evaluate(rule, mkGuest()).appliedTierId).toBeUndefined();
  });
  it("canonicalJson turns array holes into null", () => {
    expect(canonicalJson([1, , 2])).toBe("[1,null,2]");
  });
});

describe("hardening: untrusted snapshot numbers and dates", () => {
  const rule = (c: ReturnType<typeof cond>) => oneTier(c);
  it("string numerics never pass by coercion", () => {
    const pr = mkPr();
    (pr as unknown as { additions: string }).additions = "5";
    (pr as unknown as { deletions: string }).deletions = "1";
    const r = evaluate(rule(cond("merged_prs", 1, { minLinesChanged: 50 })), mkSnap({ mergedPrs: [pr] }));
    expect(r.tiers[0]!.passed).toBe(false);
    const s = mkSnap();
    (s.user as unknown as { followers: string }).followers = "5000";
    const r2 = evaluate(rule(cond("followers", 10)), s);
    expect(r2.tiers[0]!.conditions[0]!.actual).toBe(0);
  });
  it("one PR with undefined stars does not poison max stars", () => {
    const good = mkPr({ url: "https://github.com/o/good/pull/1", repo: { stars: 5000 } });
    const bad = mkPr({ url: "https://github.com/o/bad/pull/2", repo: { stars: undefined as unknown as number } });
    const r = evaluate(rule(cond("max_repo_stars_merged_pr", 1000)), mkSnap({ mergedPrs: [bad, good] }));
    expect(r.tiers[0]!.conditions[0]!.actual).toBe(5000);
    expect(r.tiers[0]!.passed).toBe(true);
  });
  it("duplicate PR entries count once", () => {
    const pr = mkPr({ url: "https://github.com/o/r/pull/1" });
    const r = evaluate(rule(cond("merged_prs", 2)), mkSnap({ mergedPrs: [pr, { ...pr }] }));
    expect(r.tiers[0]!.conditions[0]!.actual).toBe(1);
  });
  it("a PR merged after now fails mergedSince", () => {
    const pr = mkPr({ mergedAt: "2027-06-01T00:00:00.000Z" });
    const r = evaluate(rule(cond("merged_prs", 1, { mergedSince: "year_start" })), mkSnap({ mergedPrs: [pr] }), new Date(T0));
    expect(r.tiers[0]!.passed).toBe(false);
  });
  it("timestamps without an offset never pass date filters", () => {
    const pr = mkPr({ mergedAt: "2026-03-01T00:00:00" });
    const r = evaluate(rule(cond("merged_prs", 1, { mergedSince: "year_start" })), mkSnap({ mergedPrs: [pr] }), new Date(T0));
    expect(r.tiers[0]!.passed).toBe(false);
  });
  it("account age is a finite number even for a bad createdAt", () => {
    const s = mkSnap();
    s.user.createdAt = "not a date";
    const r = evaluate(rule(cond("account_age_days", 1)), s);
    expect(Number.isFinite(r.tiers[0]!.conditions[0]!.actual)).toBe(true);
    expect(r.tiers[0]!.passed).toBe(false);
  });
});

describe("hardening: readback line count", () => {
  it("is tiers + 1 lines", () => {
    expect(readback(oneTier(cond("followers", 10))).split("\n")).toHaveLength(2);
  });
});

describe("anonymise: login anywhere in a repo name", () => {
  it("drops a kept repo name that merely contains the login", async () => {
    const { anonymiseSnapshot } = await import("../src/facts/anonymise");
    const s = mkSnap({
      user: { login: "react" },
      mergedPrs: [mkPr({ repo: { nameWithOwner: "facebook/react", stars: 200_000, ownerIsAuthor: false } })],
    });
    const out = anonymiseSnapshot(s, { label: "x", recordedAt: "2026-11-10T00:00:00.000Z", keepRepoNames: true });
    expect(out.mergedPrs[0]!.repo.nameWithOwner).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("react");
  });
});

describe("client address behind Render (Cloudflare edge plus balancer)", () => {
  it("uses the edge's own header when it holds a valid address, ignoring everything a client can add to x-forwarded-for", async () => {
    const { clientIp } = await import("../src/ratelimit");
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 108.194.8.11, 104.22.160.12, 10.29.152.142", "cf-connecting-ip": "108.194.8.11" });
    expect(clientIp(h, 3, "cf-connecting-ip")).toBe("108.194.8.11");
    // Header absent or invalid: the hop count still lands on the real client (3 from the right), not the balancer.
    h.delete("cf-connecting-ip");
    expect(clientIp(h, 3, "cf-connecting-ip")).toBe("108.194.8.11");
    expect(clientIp(new Headers({ "x-forwarded-for": "5.5.5.5,108.194.8.11,104.22.160.62,10.29.152.142", "cf-connecting-ip": "not an ip" }), 3, "cf-connecting-ip")).toBe("108.194.8.11");
    // The old setting (1 hop) would have keyed everyone on the balancer: the regression this guards against.
    expect(clientIp(new Headers({ "x-forwarded-for": "108.194.8.11,104.22.160.62,10.29.152.142" }), 1, undefined)).toBe("10.29.152.142");
  });
});
