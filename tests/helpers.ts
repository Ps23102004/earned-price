// Shared fixtures for the B2a tests. Explicit ISO timestamps only; never the real clock.
import type { GithubSnapshot, GuestSnapshot, MergedPr } from "../src/facts/types";
import type { Condition, Field, PrFilters, Rule } from "../src/rules/types";

export const DAY = 86_400_000;
export const T0 = "2026-06-15T12:00:00.000Z";

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** ISO instant `days` whole days (plus `extraMs`) before `isoStr`. */
export function daysBefore(isoStr: string, days: number, extraMs = 0): string {
  return iso(Date.parse(isoStr) - days * DAY - extraMs);
}

/** Index access that fails loudly instead of returning undefined. */
export function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`no element at index ${i}`);
  return v;
}

export type PrOver = Omit<Partial<MergedPr>, "repo"> & { repo?: Partial<MergedPr["repo"]> };

export function mkPr(over: PrOver = {}): MergedPr {
  const { repo, ...rest } = over;
  const number = over.number ?? 1;
  return {
    url: `https://github.com/acme/widgets/pull/${number}`,
    number,
    mergedAt: "2026-03-01T00:00:00.000Z",
    additions: 10,
    deletions: 5,
    changedFiles: 1,
    repo: {
      nameWithOwner: "acme/widgets",
      url: "https://github.com/acme/widgets",
      stars: 5000,
      ownerLogin: "acme",
      ownerIsAuthor: false,
      ownerType: "Organization",
      isFork: false,
      ...repo,
    },
    ...rest,
  };
}

/** Same PR with the `url` property removed entirely. */
export function noUrl(pr: MergedPr): MergedPr {
  const copy = { ...pr };
  delete copy.url;
  return copy;
}

type SnapOver = Omit<Partial<GithubSnapshot>, "user"> & { user?: Partial<GithubSnapshot["user"]> };

export function mkSnap(over: SnapOver = {}): GithubSnapshot {
  const { user, ...rest } = over;
  return {
    version: 1,
    kind: "github",
    source: "sample",
    fetchedAt: T0,
    user: {
      login: "octo",
      url: "https://github.com/octo",
      createdAt: "2020-01-01T00:00:00.000Z",
      followers: 10,
      publicRepos: 5,
      commitContributionsLastYear: 100,
      ...user,
    },
    mergedPrs: [],
    truncated: false,
    ...rest,
  };
}

/** Snapshot whose user has no `url` property. */
export function mkSnapNoUserUrl(over: SnapOver = {}): GithubSnapshot {
  const s = mkSnap(over);
  const user = { ...s.user };
  delete user.url;
  return { ...s, user };
}

export function mkGuest(fetchedAt: string = T0): GuestSnapshot {
  return { version: 1, kind: "guest", fetchedAt };
}

export function cond(field: Field, value: number, pr?: PrFilters): Condition {
  return pr === undefined ? { field, op: "gte", value } : { field, op: "gte", value, pr };
}

export function oneTier(c: Condition | Condition[], discountPercent = 10, id = "t1"): Rule {
  return {
    version: 1,
    tiers: [{ id, label: "Tier one", discountPercent, conditions: Array.isArray(c) ? c : [c] }],
  };
}

/** The brief's example rule: 50% / 20% / 10%. Fresh copy each call. */
export function makeExampleRule(): Rule {
  return {
    version: 1,
    tiers: [
      {
        id: "t1",
        label: "core contributor",
        discountPercent: 50,
        conditions: [
          { field: "max_repo_stars_merged_pr", op: "gte", value: 1000, pr: { mergedSince: "year_start" } },
        ],
      },
      {
        id: "t2",
        label: "contributor",
        discountPercent: 20,
        conditions: [{ field: "merged_prs", op: "gte", value: 1 }],
      },
      {
        id: "t3",
        label: "veteran",
        discountPercent: 10,
        conditions: [{ field: "account_age_days", op: "gte", value: 1095 }],
      },
    ],
  };
}
