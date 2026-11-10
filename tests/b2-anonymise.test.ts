// B2 anonymise: written from docs/specs/B2-facts-signin-price.md only.
import { describe, expect, it } from "vitest";
import { anonymiseSnapshot, bucket, coarsenMonth } from "../src/facts/anonymise";
import type { GithubSnapshot } from "../src/facts/types";
import { at, mkPr, mkSnap } from "./helpers";

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

describe("bucket boundaries", () => {
  it.each([
    [0, 0],
    [1, 2],
    [2, 2],
    [3, 6],
    [9, 6],
    [10, 30],
    [49, 30],
    [50, 125],
    [199, 125],
    [200, 600],
    [999, 600],
    [1000, 3000],
    [4999, 3000],
    [5000, 12500],
    [19999, 12500],
    [20000, 60000],
    [99999, 60000],
    [100000, 100000],
    [100001, 100000],
    [5_000_000, 100000],
  ])("bucket(%d) = %d", (n, expected) => {
    expect(bucket(n)).toBe(expected);
  });

  it.each([
    ["NaN", Number.NaN],
    ["negative", -1],
    ["large negative", -50_000],
    ["float 1.5", 1.5],
    ["float 2.5", 2.5],
    ["float 0.5", 0.5],
    ["float 1234.56", 1234.56],
  ])("non-integer / negative / NaN input (%s) -> 0", (_name, n) => {
    expect(bucket(n)).toBe(0);
  });

  it("is monotonic non-decreasing across a sweep of integers", () => {
    let prev = bucket(0);
    for (let n = 1; n <= 250_000; n += n < 1000 ? 1 : 7) {
      const b = bucket(n);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it("only ever returns one of the documented midpoints for non-negative integers", () => {
    const allowed = new Set([0, 2, 6, 30, 125, 600, 3000, 12500, 60000, 100000]);
    for (const n of [0, 1, 2, 3, 7, 12, 77, 321, 1500, 9000, 50_000, 123_456]) {
      expect(allowed.has(bucket(n))).toBe(true);
    }
  });
});

describe("coarsenMonth", () => {
  it.each([
    ["2024-03-17T10:20:30Z", "2024-03-15T00:00:00.000Z"],
    ["2024-03-01T00:00:00.000Z", "2024-03-15T00:00:00.000Z"],
    ["2024-03-31T23:59:59.999Z", "2024-03-15T00:00:00.000Z"],
    ["2020-02-29T08:00:00Z", "2020-02-15T00:00:00.000Z"],
    ["2019-12-02T12:00:00.123Z", "2019-12-15T00:00:00.000Z"],
    ["2024-03-17T12:00:00+02:00", "2024-03-15T00:00:00.000Z"],
  ])("%s -> %s", (input, expected) => {
    expect(coarsenMonth(input)).toBe(expected);
  });

  it("always yields YYYY-MM-15T00:00:00.000Z", () => {
    expect(coarsenMonth("2023-07-04T04:05:06Z")).toMatch(/^\d{4}-\d{2}-15T00:00:00\.000Z$/);
  });

  it.each([["", "empty"], ["not a date", "garbage"], ["2024-13-01T00:00:00Z", "month 13"], ["yesterday", "word"]])(
    "throws for invalid input %j (%s)",
    (input) => {
      expect(() => coarsenMonth(input)).toThrow();
    },
  );
});

// ---- anonymiseSnapshot ------------------------------------------------------

const OPTS = { label: "qualifies sample", recordedAt: "2026-06-15T12:00:00.000Z", keepRepoNames: true };

function richSnapshot(): GithubSnapshot {
  return mkSnap({
    source: "live",
    user: {
      login: "secret-login-abc",
      url: "https://github.com/secret-login-abc",
      createdAt: "2019-08-23T17:45:12.000Z",
      followers: 37,
      publicRepos: 12,
      commitContributionsLastYear: 640,
    },
    mergedPrs: [
      mkPr({
        number: 4242,
        url: "https://github.com/bigorg/bigrepo/pull/4242",
        mergedAt: "2026-02-11T09:30:00.000Z",
        additions: 120,
        deletions: 33,
        changedFiles: 4,
        repo: {
          nameWithOwner: "bigorg/bigrepo",
          url: "https://github.com/bigorg/bigrepo",
          stars: 45_000,
          ownerLogin: "bigorg",
          ownerIsAuthor: false,
          ownerType: "Organization",
          isFork: false,
        },
      }),
      mkPr({
        number: 7,
        url: "https://github.com/secret-login-abc/mine/pull/7",
        mergedAt: "2026-04-30T23:00:00.000Z",
        additions: 2,
        deletions: 1,
        changedFiles: 1,
        repo: {
          nameWithOwner: "secret-login-abc/mine",
          url: "https://github.com/secret-login-abc/mine",
          stars: 5,
          ownerLogin: "secret-login-abc",
          ownerIsAuthor: true,
          ownerType: "User",
          isFork: true,
        },
      }),
    ],
    truncated: true,
  });
}

describe("anonymiseSnapshot", () => {
  it("sets source/label/recordedAt and keeps kind and version", () => {
    const out = anonymiseSnapshot(richSnapshot(), OPTS);
    expect(out.version).toBe(1);
    expect(out.kind).toBe("github");
    expect(out.source).toBe("sample");
    expect(out.label).toBe("qualifies sample");
    expect(out.recordedAt).toBe("2026-06-15T12:00:00.000Z");
  });

  it("removes user login and url, coarsens createdAt, buckets counts", () => {
    const out = anonymiseSnapshot(richSnapshot(), OPTS);
    expect(out.user.login).toBeUndefined();
    expect(out.user.url).toBeUndefined();
    expect(out.user.createdAt).toBe("2019-08-15T00:00:00.000Z");
    expect(out.user.followers).toBe(bucket(37));
    expect(out.user.publicRepos).toBe(bucket(12));
    expect(out.user.commitContributionsLastYear).toBe(bucket(640));
    expect(out.user.followers).toBe(30);
    expect(out.user.publicRepos).toBe(30);
    expect(out.user.commitContributionsLastYear).toBe(600); // 640 is in the 200-999 bucket
  });

  it("removes every PR url/number/ownerLogin and repo url; coarsens mergedAt; buckets numbers", () => {
    const out = anonymiseSnapshot(richSnapshot(), OPTS);
    expect(out.mergedPrs).toHaveLength(2);
    const first = at(out.mergedPrs, 0);
    const second = at(out.mergedPrs, 1);
    for (const pr of out.mergedPrs) {
      expect(pr.url).toBeUndefined();
      expect(pr.number).toBeUndefined();
      expect(pr.repo.ownerLogin).toBeUndefined();
      expect(pr.repo.url).toBeUndefined();
    }
    expect(first.mergedAt).toBe("2026-02-15T00:00:00.000Z");
    expect(second.mergedAt).toBe("2026-04-15T00:00:00.000Z");
    expect(first.additions).toBe(bucket(120));
    expect(first.deletions).toBe(bucket(33));
    expect(first.changedFiles).toBe(bucket(4));
    expect(first.repo.stars).toBe(bucket(45_000));
    expect(second.additions).toBe(bucket(2));
    expect(second.repo.stars).toBe(bucket(5));
  });

  it("keeps ownerIsAuthor, isFork, ownerType and truncated", () => {
    const out = anonymiseSnapshot(richSnapshot(), OPTS);
    const first = at(out.mergedPrs, 0);
    const second = at(out.mergedPrs, 1);
    expect([first.repo.ownerIsAuthor, first.repo.isFork, first.repo.ownerType]).toEqual([false, false, "Organization"]);
    expect([second.repo.ownerIsAuthor, second.repo.isFork, second.repo.ownerType]).toEqual([true, true, "User"]);
    expect(out.truncated).toBe(true);
    expect(anonymiseSnapshot(mkSnap({ truncated: false }), OPTS).truncated).toBe(false);
  });

  it("keeps PR order and count", () => {
    const s = mkSnap({
      mergedPrs: [3, 2, 1].map((n) => mkPr({ number: n, mergedAt: `2026-0${n}-10T00:00:00.000Z` })),
    });
    const out = anonymiseSnapshot(s, OPTS);
    expect(out.mergedPrs.map((p) => p.mergedAt)).toEqual([
      "2026-03-15T00:00:00.000Z",
      "2026-02-15T00:00:00.000Z",
      "2026-01-15T00:00:00.000Z",
    ]);
  });

  describe("repo name retention", () => {
    const withStars = (stars: number) =>
      mkSnap({ mergedPrs: [mkPr({ repo: { nameWithOwner: "bigorg/bigrepo", stars } })] });
    const nameOf = (s: GithubSnapshot, keep: boolean) =>
      at(anonymiseSnapshot(s, { ...OPTS, keepRepoNames: keep }).mergedPrs, 0).repo.nameWithOwner;

    it("kept when keepRepoNames and stars >= 20,000", () => {
      expect(nameOf(withStars(20_000), true)).toBe("bigorg/bigrepo");
      expect(nameOf(withStars(300_000), true)).toBe("bigorg/bigrepo");
    });

    it("removed when stars are 19,999 even with keepRepoNames", () => {
      expect(nameOf(withStars(19_999), true)).toBeUndefined();
    });

    it("removed when keepRepoNames is false even for a famous repo", () => {
      expect(nameOf(withStars(300_000), false)).toBeUndefined();
      expect(nameOf(withStars(20_000), false)).toBeUndefined();
    });

    it("decides on the ORIGINAL stars, not the bucketed value", () => {
      // bucket(19_999) = 12,500 and bucket(20_000) = 60,000: 20,000 original is kept, 19,999 is not.
      expect(nameOf(withStars(20_000), true)).toBeDefined();
      expect(nameOf(withStars(19_999), true)).toBeUndefined();
    });
  });

  it("does not mutate a deeply frozen input", () => {
    const input = deepFreeze(richSnapshot());
    const before = structuredClone(input);
    expect(() => anonymiseSnapshot(input, OPTS)).not.toThrow();
    expect(input).toEqual(before);
  });

  it("returns a new object graph (no shared nested references with the input)", () => {
    const input = richSnapshot();
    const out = anonymiseSnapshot(input, OPTS);
    expect(out).not.toBe(input);
    expect(out.user).not.toBe(input.user);
    expect(out.mergedPrs).not.toBe(input.mergedPrs);
  });

  it("handles a snapshot with no PRs and no user url", () => {
    const out = anonymiseSnapshot(mkSnap({ mergedPrs: [] }), OPTS);
    expect(out.mergedPrs).toEqual([]);
    expect(out.user.login).toBeUndefined();
  });
});

// Deterministic PRNG so the property test is reproducible without extra dependencies.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("anonymiseSnapshot identifying-string property", () => {
  it("JSON of the output contains none of the removed strings (200 random snapshots)", () => {
    const rand = rng(20261110);
    const tok = (prefix: string) => `${prefix}${Math.floor(rand() * 1e12).toString(36)}${Math.floor(rand() * 1e12).toString(36)}`;
    const starsChoices = [0, 3, 999, 1000, 5000, 19_999, 20_000, 75_000, 400_000];

    for (let i = 0; i < 200; i++) {
      const login = tok("zqlogin");
      const nPrs = Math.floor(rand() * 6);
      const keep = rand() < 0.5;
      const removed: string[] = [login, `https://github.com/${login}`];
      const mergedPrs = Array.from({ length: nPrs }, (_, j) => {
        const owner = tok("zqowner");
        const repoName = tok("zqrepo");
        const stars = starsChoices[Math.floor(rand() * starsChoices.length)] ?? 0;
        const nameWithOwner = `${owner}/${repoName}`;
        const prUrl = `https://github.com/${nameWithOwner}/pull/${j + 1}`;
        const repoUrl = `https://github.com/${nameWithOwner}`;
        removed.push(prUrl, repoUrl);
        // A kept name legitimately contains owner and repo, so they only count as removed with it.
        if (!(keep && stars >= 20_000)) removed.push(nameWithOwner, repoName, owner);
        return mkPr({
          number: j + 1,
          url: prUrl,
          mergedAt: `2026-0${1 + Math.floor(rand() * 6)}-${10 + Math.floor(rand() * 18)}T12:34:56.000Z`,
          additions: Math.floor(rand() * 5000),
          deletions: Math.floor(rand() * 5000),
          changedFiles: Math.floor(rand() * 300),
          repo: {
            nameWithOwner,
            url: repoUrl,
            stars,
            ownerLogin: owner,
            ownerIsAuthor: rand() < 0.3,
            ownerType: rand() < 0.5 ? "User" : "Organization",
            isFork: rand() < 0.2,
          },
        });
      });
      const snap = mkSnap({
        user: { login, url: `https://github.com/${login}`, createdAt: "2018-05-05T05:05:05.000Z" },
        mergedPrs,
      });
      const json = JSON.stringify(anonymiseSnapshot(snap, { label: "sample", recordedAt: OPTS.recordedAt, keepRepoNames: keep }));
      for (const s of removed) expect(json).not.toContain(s);
    }
  });
});
