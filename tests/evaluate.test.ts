import { describe, expect, it } from "vitest";
import type { FactSnapshot } from "../src/facts/types";
import { evaluate } from "../src/rules/evaluate";
import type { Condition, PrFilters, Rule } from "../src/rules/types";
import {
  DAY,
  T0,
  at,
  cond,
  daysBefore,
  iso,
  makeExampleRule,
  mkGuest,
  mkPr,
  mkSnap,
  mkSnapNoUserUrl,
  noUrl,
  oneTier,
  type PrOver,
} from "./helpers";

function condResult(c: Condition, snap: FactSnapshot, now?: Date) {
  const res = evaluate(oneTier(c), snap, now);
  return at(at(res.tiers, 0).conditions, 0);
}

const actualOf = (c: Condition, snap: FactSnapshot, now?: Date) => condResult(c, snap, now).actual;

describe("evaluate: field values", () => {
  it("account_age_days is floor((now - createdAt) / DAY_MS)", () => {
    const c = cond("account_age_days", 1);
    expect(actualOf(c, mkSnap({ user: { createdAt: daysBefore(T0, 400) } }))).toBe(400);
  });

  it("account_age_days floors a partial day down (400 days + 1 ms)", () => {
    const c = cond("account_age_days", 1);
    expect(actualOf(c, mkSnap({ user: { createdAt: daysBefore(T0, 400, 1) } }))).toBe(400);
  });

  it("account_age_days floors 401 days minus 1 ms to 400", () => {
    const c = cond("account_age_days", 1);
    const createdAt = iso(Date.parse(T0) - 401 * DAY + 1);
    expect(actualOf(c, mkSnap({ user: { createdAt } }))).toBe(400);
  });

  it("account_age_days is 0 for an account created at the clock instant", () => {
    expect(actualOf(cond("account_age_days", 1), mkSnap({ user: { createdAt: T0 } }))).toBe(0);
  });

  it("followers is user.followers", () => {
    expect(actualOf(cond("followers", 1), mkSnap({ user: { followers: 1234 } }))).toBe(1234);
  });

  it("public_repos is user.publicRepos", () => {
    expect(actualOf(cond("public_repos", 1), mkSnap({ user: { publicRepos: 42 } }))).toBe(42);
  });

  it("commit_contributions_last_year is user.commitContributionsLastYear", () => {
    const snap = mkSnap({ user: { commitContributionsLastYear: 777 } });
    expect(actualOf(cond("commit_contributions_last_year", 1), snap)).toBe(777);
  });

  it("merged_prs counts every merged PR when there are no filters", () => {
    const snap = mkSnap({ mergedPrs: [mkPr({ number: 1 }), mkPr({ number: 2 }), mkPr({ number: 3 })] });
    expect(actualOf(cond("merged_prs", 1), snap)).toBe(3);
  });

  it("merged_prs is 0 with no merged PRs", () => {
    expect(actualOf(cond("merged_prs", 1), mkSnap())).toBe(0);
  });

  it("max_repo_stars_merged_pr is the max stars over merged PRs", () => {
    const snap = mkSnap({
      mergedPrs: [
        mkPr({ number: 1, repo: { stars: 100 } }),
        mkPr({ number: 2, repo: { stars: 2500 } }),
        mkPr({ number: 3, repo: { stars: 40 } }),
      ],
    });
    expect(actualOf(cond("max_repo_stars_merged_pr", 1), snap)).toBe(2500);
  });

  it("max_repo_stars_merged_pr is 0 with no merged PRs", () => {
    expect(actualOf(cond("max_repo_stars_merged_pr", 1), mkSnap())).toBe(0);
  });
});

describe("evaluate: condition results", () => {
  it("passes when actual equals the threshold (gte)", () => {
    const r = condResult(cond("followers", 10), mkSnap({ user: { followers: 10 } }));
    expect(r).toMatchObject({ field: "followers", op: "gte", threshold: 10, actual: 10, passed: true });
  });

  it("passes when actual exceeds the threshold", () => {
    expect(condResult(cond("followers", 10), mkSnap({ user: { followers: 11 } })).passed).toBe(true);
  });

  it("fails when actual is one below the threshold", () => {
    const r = condResult(cond("followers", 10), mkSnap({ user: { followers: 9 } }));
    expect(r.passed).toBe(false);
    expect(r.threshold).toBe(10);
    expect(r.actual).toBe(9);
  });

  it("copies pr filters onto the condition result", () => {
    const pr: PrFilters = { minRepoStars: 100, excludeForks: true, mergedSince: "year_start" };
    const r = condResult(cond("merged_prs", 1, pr), mkSnap());
    expect(r.pr).toEqual(pr);
  });

  it("omits pr on the condition result when the condition has none", () => {
    const r = condResult(cond("merged_prs", 1), mkSnap());
    expect("pr" in r).toBe(false);
    const f = condResult(cond("followers", 1), mkSnap());
    expect("pr" in f).toBe(false);
  });
});

describe("evaluate: PR filters in isolation", () => {
  type Case = {
    name: string;
    filters: PrFilters;
    user?: { createdAt: string };
    bad: PrOver;
    good: PrOver;
  };

  const cases: Case[] = [
    {
      name: "minRepoStars",
      filters: { minRepoStars: 100 },
      bad: { repo: { stars: 99 } },
      good: { repo: { stars: 100 } },
    },
    {
      name: "minLinesChanged (additions + deletions)",
      filters: { minLinesChanged: 20 },
      bad: { additions: 10, deletions: 9 },
      good: { additions: 10, deletions: 10 },
    },
    {
      name: "excludeOwnRepos",
      filters: { excludeOwnRepos: true },
      bad: { repo: { ownerIsAuthor: true } },
      good: { repo: { ownerIsAuthor: false } },
    },
    {
      name: "excludeForks",
      filters: { excludeForks: true },
      bad: { repo: { isFork: true } },
      good: { repo: { isFork: false } },
    },
    {
      name: "mergedSince year_start (1 ms before vs at Jan 1 00:00 UTC)",
      filters: { mergedSince: "year_start" },
      bad: { mergedAt: "2025-12-31T23:59:59.999Z" },
      good: { mergedAt: "2026-01-01T00:00:00.000Z" },
    },
    {
      name: "mergedSince YYYY-MM-DD (1 ms before vs at 00:00 UTC)",
      filters: { mergedSince: "2026-02-01" },
      bad: { mergedAt: "2026-01-31T23:59:59.999Z" },
      good: { mergedAt: "2026-02-01T00:00:00.000Z" },
    },
    {
      name: "minAccountAgeDaysAtMerge (floor of whole days)",
      filters: { minAccountAgeDaysAtMerge: 30 },
      user: { createdAt: "2026-01-01T00:00:00.000Z" },
      bad: { mergedAt: "2026-01-30T23:59:59.999Z" },
      good: { mergedAt: "2026-01-31T00:00:00.000Z" },
    },
  ];

  for (const c of cases) {
    describe(c.name, () => {
      const snapWith = (prs: ReturnType<typeof mkPr>[]) =>
        mkSnap({ ...(c.user ? { user: c.user } : {}), mergedPrs: prs });

      it("merged_prs excludes the failing PR and counts the passing one", () => {
        const both = snapWith([mkPr({ number: 1, ...c.bad }), mkPr({ number: 2, ...c.good })]);
        expect(actualOf(cond("merged_prs", 1, c.filters), both)).toBe(1);
        expect(actualOf(cond("merged_prs", 1, c.filters), snapWith([mkPr({ number: 1, ...c.bad })]))).toBe(0);
        // without the filter both count
        expect(actualOf(cond("merged_prs", 1), both)).toBe(2);
      });

      it("max_repo_stars_merged_pr only considers PRs that pass", () => {
        const bad = mkPr({ number: 1, ...c.bad, repo: { stars: c.bad.repo?.stars ?? 9000, ...c.bad.repo } });
        const good = mkPr({ number: 2, ...c.good, repo: { ...c.good.repo, stars: 500 } });
        const snap = snapWith([bad, good]);
        expect(actualOf(cond("max_repo_stars_merged_pr", 1, c.filters), snap)).toBe(500);
        expect(actualOf(cond("max_repo_stars_merged_pr", 1, c.filters), snapWith([bad]))).toBe(0);
      });
    });
  }

  it("minRepoStars boundary on max_repo_stars_merged_pr", () => {
    const snap = mkSnap({
      mergedPrs: [mkPr({ number: 1, repo: { stars: 99 } }), mkPr({ number: 2, repo: { stars: 100 } })],
    });
    expect(actualOf(cond("max_repo_stars_merged_pr", 1, { minRepoStars: 100 }), snap)).toBe(100);
    expect(actualOf(cond("max_repo_stars_merged_pr", 1, { minRepoStars: 101 }), snap)).toBe(0);
  });

  it("excludeOwnRepos: false is no filter", () => {
    const snap = mkSnap({ mergedPrs: [mkPr({ repo: { ownerIsAuthor: true } })] });
    expect(actualOf(cond("merged_prs", 1, { excludeOwnRepos: false }), snap)).toBe(1);
  });

  it("excludeForks: false is no filter", () => {
    const snap = mkSnap({ mergedPrs: [mkPr({ repo: { isFork: true } })] });
    expect(actualOf(cond("merged_prs", 1, { excludeForks: false }), snap)).toBe(1);
  });

  it("an empty pr object is no filter", () => {
    const snap = mkSnap({ mergedPrs: [mkPr({ repo: { isFork: true, ownerIsAuthor: true } })] });
    expect(actualOf(cond("merged_prs", 1, {}), snap)).toBe(1);
  });

  it("minLinesChanged is inclusive and sums additions and deletions", () => {
    const snap = mkSnap({ mergedPrs: [mkPr({ additions: 5, deletions: 5 })] });
    expect(actualOf(cond("merged_prs", 1, { minLinesChanged: 10 }), snap)).toBe(1);
    expect(actualOf(cond("merged_prs", 1, { minLinesChanged: 11 }), snap)).toBe(0);
  });
});

describe("evaluate: PR filters combined", () => {
  const filters: PrFilters = {
    minRepoStars: 100,
    minLinesChanged: 20,
    excludeOwnRepos: true,
    excludeForks: true,
    mergedSince: "2026-01-15",
    minAccountAgeDaysAtMerge: 30,
  };
  const user = { createdAt: "2026-01-01T00:00:00.000Z" };
  const good = mkPr({ number: 1, mergedAt: "2026-03-01T00:00:00.000Z", additions: 15, deletions: 15, repo: { stars: 500 } });

  it("counts only the PR that passes every filter", () => {
    const bads = [
      mkPr({ number: 2, repo: { stars: 99 } }),
      mkPr({ number: 3, additions: 10, deletions: 9 }),
      mkPr({ number: 4, repo: { ownerIsAuthor: true } }),
      mkPr({ number: 5, repo: { isFork: true } }),
      // before mergedSince (also younger than 30 days at merge)
      mkPr({ number: 6, mergedAt: "2026-01-14T23:59:59.999Z" }),
      // after mergedSince but account only 19 days old at merge
      mkPr({ number: 7, mergedAt: "2026-01-20T00:00:00.000Z" }),
    ];
    const snap = mkSnap({ user, mergedPrs: [...bads, good] });
    expect(actualOf(cond("merged_prs", 1, filters), snap)).toBe(1);
    expect(actualOf(cond("max_repo_stars_merged_pr", 1, filters), snap)).toBe(500);
    expect(condResult(cond("merged_prs", 1, filters), snap).evidence).toEqual([good.url]);
  });

  it("is 0 when no PR passes every filter", () => {
    const snap = mkSnap({ user, mergedPrs: [mkPr({ number: 2, repo: { stars: 99 } })] });
    expect(actualOf(cond("merged_prs", 1, filters), snap)).toBe(0);
    expect(actualOf(cond("max_repo_stars_merged_pr", 1, filters), snap)).toBe(0);
  });
});

describe("evaluate: clock selection", () => {
  const fetchedAt = "2026-06-15T12:00:00.000Z";
  const recordedAt = "2024-06-15T12:00:00.000Z";
  const nowArg = new Date("2025-01-01T00:00:00.000Z");
  const createdAt = "2020-01-01T00:00:00.000Z";
  const age = (clock: string) => Math.floor((Date.parse(clock) - Date.parse(createdAt)) / DAY);
  const snapBoth = () => mkSnap({ fetchedAt, recordedAt, user: { createdAt } });
  const ageCond = cond("account_age_days", 1);

  it("uses the now argument over recordedAt and fetchedAt", () => {
    const res = evaluate(oneTier(ageCond), snapBoth(), nowArg);
    expect(res.now).toBe("2025-01-01T00:00:00.000Z");
    expect(at(at(res.tiers, 0).conditions, 0).actual).toBe(age("2025-01-01T00:00:00.000Z"));
  });

  it("uses recordedAt over fetchedAt when no now argument is given", () => {
    const res = evaluate(oneTier(ageCond), snapBoth());
    expect(res.now).toBe(recordedAt);
    expect(at(at(res.tiers, 0).conditions, 0).actual).toBe(age(recordedAt));
  });

  it("falls back to fetchedAt when there is no recordedAt", () => {
    const res = evaluate(oneTier(ageCond), mkSnap({ fetchedAt, user: { createdAt } }));
    expect(res.now).toBe(fetchedAt);
    expect(at(at(res.tiers, 0).conditions, 0).actual).toBe(age(fetchedAt));
  });

  it("reports now as toISOString() (normalises a timestamp without milliseconds)", () => {
    const res = evaluate(oneTier(ageCond), mkSnap({ fetchedAt: "2026-06-15T12:00:00Z" }));
    expect(res.now).toBe("2026-06-15T12:00:00.000Z");
  });

  it("the three clocks give three different ages in this fixture", () => {
    expect(new Set([age(fetchedAt), age(recordedAt), age("2025-01-01T00:00:00.000Z")]).size).toBe(3);
  });

  it("year_start follows the now argument's UTC year", () => {
    const snap = mkSnap({ mergedPrs: [mkPr({ mergedAt: "2026-03-01T00:00:00.000Z" })] });
    const c = cond("merged_prs", 1, { mergedSince: "year_start" });
    expect(actualOf(c, snap, new Date("2026-12-31T23:59:59.999Z"))).toBe(1);
    expect(actualOf(c, snap, new Date("2027-01-01T00:00:00.000Z"))).toBe(0);
  });

  it("year_start follows recordedAt's year, not fetchedAt's", () => {
    const snap = mkSnap({
      fetchedAt: "2026-06-15T12:00:00.000Z",
      recordedAt: "2025-07-01T00:00:00.000Z",
      mergedPrs: [mkPr({ number: 1, mergedAt: "2025-03-01T00:00:00.000Z" }), mkPr({ number: 2, mergedAt: "2026-02-01T00:00:00.000Z" })],
    });
    // both are >= Jan 1 2025, so both count (no upper bound)
    expect(actualOf(cond("merged_prs", 1, { mergedSince: "year_start" }), snap)).toBe(2);
    const earlier = mkSnap({
      fetchedAt: "2026-06-15T12:00:00.000Z",
      recordedAt: "2025-07-01T00:00:00.000Z",
      mergedPrs: [mkPr({ number: 1, mergedAt: "2024-12-31T23:59:59.999Z" })],
    });
    expect(actualOf(cond("merged_prs", 1, { mergedSince: "year_start" }), earlier)).toBe(0);
  });

  it("year_start follows fetchedAt's year when there is no recordedAt", () => {
    const snap = mkSnap({
      fetchedAt: "2026-06-15T12:00:00.000Z",
      mergedPrs: [mkPr({ mergedAt: "2025-12-31T23:59:59.999Z" })],
    });
    expect(actualOf(cond("merged_prs", 1, { mergedSince: "year_start" }), snap)).toBe(0);
  });

  it("mergedSince YYYY-MM-DD does not depend on the clock", () => {
    const snap = mkSnap({ mergedPrs: [mkPr({ mergedAt: "2026-02-01T00:00:00.000Z" })] });
    const c = cond("merged_prs", 1, { mergedSince: "2026-02-01" });
    expect(actualOf(c, snap, new Date("2026-02-02T00:00:00.000Z"))).toBe(1);
    expect(actualOf(c, snap, new Date("2031-02-02T00:00:00.000Z"))).toBe(1);
  });
});

describe("evaluate: guest snapshot", () => {
  it("every field is 0, every condition and tier fails, evidence is empty", () => {
    const rule = makeExampleRule();
    const res = evaluate(rule, mkGuest());
    expect(res.appliedTierId).toBeUndefined();
    expect(res.tiers).toHaveLength(rule.tiers.length);
    res.tiers.forEach((t, i) => {
      const rt = at(rule.tiers, i);
      expect(t.tierId).toBe(rt.id);
      expect(t.passed).toBe(false);
      expect(t.conditions).toHaveLength(rt.conditions.length);
      t.conditions.forEach((c, j) => {
        const rc = at(rt.conditions, j);
        expect(c.actual).toBe(0);
        expect(c.passed).toBe(false);
        expect(c.threshold).toBe(rc.value);
        expect(c.evidence).toEqual([]);
        expect(c.field).toBe(rc.field);
      });
    });
  });

  it("every field evaluates to 0 on a guest", () => {
    const fields = [
      "account_age_days",
      "followers",
      "public_repos",
      "commit_contributions_last_year",
      "merged_prs",
      "max_repo_stars_merged_pr",
    ] as const;
    for (const f of fields) {
      const r = condResult(cond(f, 1), mkGuest());
      expect(r.actual, f).toBe(0);
      expect(r.passed, f).toBe(false);
      expect(r.evidence, f).toEqual([]);
    }
  });

  it("uses fetchedAt as the clock, or the now argument when given", () => {
    expect(evaluate(makeExampleRule(), mkGuest("2026-01-02T03:04:05.000Z")).now).toBe("2026-01-02T03:04:05.000Z");
    expect(evaluate(makeExampleRule(), mkGuest(), new Date("2030-01-01T00:00:00.000Z")).now).toBe("2030-01-01T00:00:00.000Z");
  });

  it("still copies pr filters on guest condition results", () => {
    const r = condResult(cond("merged_prs", 1, { excludeForks: true }), mkGuest());
    expect(r.pr).toEqual({ excludeForks: true });
  });
});

describe("evaluate: tiers", () => {
  const passing = () => cond("followers", 1); // snapshot has 10 followers
  const failing = () => cond("followers", 100_000);

  function ruleOf(tiers: Array<[string, number, boolean]>): Rule {
    return {
      version: 1,
      tiers: tiers.map(([id, discountPercent, ok]) => ({
        id,
        label: `label-${id}`,
        discountPercent,
        conditions: [ok ? passing() : failing()],
      })),
    };
  }

  it("emits one tier result per rule tier, in order, with id/label/discount copied", () => {
    const rule = makeExampleRule();
    const res = evaluate(rule, mkSnap());
    expect(res.tiers.map((t) => t.tierId)).toEqual(["t1", "t2", "t3"]);
    expect(res.tiers.map((t) => t.label)).toEqual(["core contributor", "contributor", "veteran"]);
    expect(res.tiers.map((t) => t.discountPercent)).toEqual([50, 20, 10]);
  });

  it("a tier passes iff all its conditions pass", () => {
    const both: Rule = oneTier([passing(), cond("public_repos", 1)]);
    expect(at(evaluate(both, mkSnap()).tiers, 0).passed).toBe(true);
    const oneFails: Rule = oneTier([passing(), failing()]);
    const r = at(evaluate(oneFails, mkSnap()).tiers, 0);
    expect(r.passed).toBe(false);
    expect(r.conditions.map((c) => c.passed)).toEqual([true, false]);
  });

  it("condition results keep rule order", () => {
    const rule = oneTier([cond("followers", 5), cond("public_repos", 2), cond("merged_prs", 1)]);
    const t = at(evaluate(rule, mkSnap()).tiers, 0);
    expect(t.conditions.map((c) => c.field)).toEqual(["followers", "public_repos", "merged_prs"]);
    expect(t.conditions.map((c) => c.threshold)).toEqual([5, 2, 1]);
  });

  it("appliedTierId is the passing tier with the largest discount", () => {
    const res = evaluate(ruleOf([["a", 10, true], ["b", 30, true], ["c", 20, true]]), mkSnap());
    expect(res.appliedTierId).toBe("b");
  });

  it("a later, larger discount beats an earlier smaller one", () => {
    expect(evaluate(ruleOf([["a", 10, true], ["b", 50, true]]), mkSnap()).appliedTierId).toBe("b");
  });

  it("ignores failing tiers even when their discount is larger", () => {
    expect(evaluate(ruleOf([["a", 10, true], ["b", 50, false]]), mkSnap()).appliedTierId).toBe("a");
  });

  it("ties on discount go to the tier that comes first", () => {
    expect(evaluate(ruleOf([["a", 10, true], ["b", 30, true], ["c", 30, true]]), mkSnap()).appliedTierId).toBe("b");
    expect(evaluate(ruleOf([["x", 30, true], ["y", 30, true]]), mkSnap()).appliedTierId).toBe("x");
  });

  it("a failing tier does not win a tie against a passing one", () => {
    expect(evaluate(ruleOf([["a", 30, false], ["b", 30, true]]), mkSnap()).appliedTierId).toBe("b");
  });

  it("appliedTierId is undefined when no tier passes", () => {
    expect(evaluate(ruleOf([["a", 10, false], ["b", 30, false]]), mkSnap()).appliedTierId).toBeUndefined();
  });

  it("the example rule applies the 50% tier for a buyer meeting all three", () => {
    const snap = mkSnap({ mergedPrs: [mkPr({ repo: { stars: 5000 } })] });
    const res = evaluate(makeExampleRule(), snap);
    expect(res.tiers.map((t) => t.passed)).toEqual([true, true, true]);
    expect(res.appliedTierId).toBe("t1");
  });
});

describe("evaluate: evidence", () => {
  it("merged_prs evidence lists the urls of passing PRs in snapshot order", () => {
    const prs = [mkPr({ number: 1 }), mkPr({ number: 2 }), mkPr({ number: 3 })];
    const r = condResult(cond("merged_prs", 1), mkSnap({ mergedPrs: prs }));
    expect(r.evidence).toEqual(prs.map((p) => p.url));
  });

  it("merged_prs evidence holds at most 5 urls (the first five)", () => {
    const prs = [1, 2, 3, 4, 5, 6, 7].map((n) => mkPr({ number: n }));
    const r = condResult(cond("merged_prs", 1), mkSnap({ mergedPrs: prs }));
    expect(r.actual).toBe(7);
    expect(r.evidence).toHaveLength(5);
    expect(r.evidence).toEqual(prs.slice(0, 5).map((p) => p.url));
  });

  it("merged_prs evidence skips PRs without a url (they still count)", () => {
    const prs = [mkPr({ number: 1 }), noUrl(mkPr({ number: 2 })), mkPr({ number: 3 })];
    const r = condResult(cond("merged_prs", 1), mkSnap({ mergedPrs: prs }));
    expect(r.actual).toBe(3);
    expect(r.evidence).toEqual([prs[0]?.url, prs[2]?.url]);
  });

  it("merged_prs evidence only includes PRs that pass the filters", () => {
    const keep = mkPr({ number: 1, repo: { isFork: false } });
    const drop = mkPr({ number: 2, repo: { isFork: true } });
    const r = condResult(cond("merged_prs", 1, { excludeForks: true }), mkSnap({ mergedPrs: [drop, keep] }));
    expect(r.evidence).toEqual([keep.url]);
  });

  it("merged_prs evidence is empty when no PR passes", () => {
    const r = condResult(cond("merged_prs", 1, { minRepoStars: 10_000_000 }), mkSnap({ mergedPrs: [mkPr()] }));
    expect(r.evidence).toEqual([]);
  });

  it("max_repo_stars_merged_pr evidence is the url of the first PR with the max stars", () => {
    const prs = [
      mkPr({ number: 1, repo: { stars: 100 } }),
      mkPr({ number: 2, repo: { stars: 900 } }),
      mkPr({ number: 3, repo: { stars: 900 } }),
      mkPr({ number: 4, repo: { stars: 300 } }),
    ];
    const r = condResult(cond("max_repo_stars_merged_pr", 1), mkSnap({ mergedPrs: prs }));
    expect(r.actual).toBe(900);
    expect(r.evidence).toEqual([prs[1]?.url]);
  });

  it("max_repo_stars_merged_pr evidence respects the filters", () => {
    const fork = mkPr({ number: 1, repo: { stars: 900, isFork: true } });
    const real = mkPr({ number: 2, repo: { stars: 900, isFork: false } });
    const r = condResult(cond("max_repo_stars_merged_pr", 1, { excludeForks: true }), mkSnap({ mergedPrs: [fork, real] }));
    expect(r.evidence).toEqual([real.url]);
  });

  it("max_repo_stars_merged_pr evidence is empty when none pass or the url is missing", () => {
    expect(condResult(cond("max_repo_stars_merged_pr", 1), mkSnap()).evidence).toEqual([]);
    const lone = noUrl(mkPr({ number: 1, repo: { stars: 900 } }));
    expect(condResult(cond("max_repo_stars_merged_pr", 1), mkSnap({ mergedPrs: [lone] })).evidence).toEqual([]);
  });

  it("user fields use [user.url]", () => {
    const snap = mkSnap();
    for (const f of ["account_age_days", "followers", "public_repos", "commit_contributions_last_year"] as const) {
      expect(condResult(cond(f, 1), snap).evidence, f).toEqual(["https://github.com/octo"]);
    }
  });

  it("user fields use [] when user.url is undefined", () => {
    const snap = mkSnapNoUserUrl();
    for (const f of ["account_age_days", "followers", "public_repos", "commit_contributions_last_year"] as const) {
      expect(condResult(cond(f, 1), snap).evidence, f).toEqual([]);
    }
  });

  it("evidence is attached even to a failing github condition", () => {
    const r = condResult(cond("followers", 100_000), mkSnap());
    expect(r.passed).toBe(false);
    expect(r.evidence).toEqual(["https://github.com/octo"]);
  });
});
