// Turns a live snapshot into a shareable recorded one: no identities, coarse dates, bucketed counts. Pure.

import type { GithubSnapshot, MergedPr } from "./types";

const BUCKETS: [number, number][] = [
  [0, 0], [2, 2], [9, 6], [49, 30], [199, 125], [999, 600], [4_999, 3_000], [19_999, 12_500], [99_999, 60_000],
];

/** Midpoint of the bucket n falls in; anything that is not a non-negative integer counts as 0. */
export function bucket(n: number): number {
  if (!Number.isInteger(n) || n < 0) return 0;
  return BUCKETS.find(([max]) => n <= max)?.[1] ?? 100_000;
}

/** Same month, 15th at midnight UTC. Throws unless the input is an ISO timestamp with an explicit offset. */
export function coarsenMonth(iso: string): string {
  const t = typeof iso === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(iso) ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) throw new Error("coarsenMonth: invalid ISO timestamp");
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-15T00:00:00.000Z`;
}

export function anonymiseSnapshot(
  s: GithubSnapshot,
  opts: { label: string; recordedAt: string; keepRepoNames: boolean },
): GithubSnapshot {
  const login = s.user.login?.toLowerCase();
  const pr = (p: MergedPr): MergedPr => {
    const name = p.repo.nameWithOwner;
    // A repository name is public, but only a very large one is not a pointer to one person.
    const keep =
      opts.keepRepoNames && name !== undefined && p.repo.stars >= 20_000 && !p.repo.ownerIsAuthor &&
      !(login && name.toLowerCase().includes(login));
    return {
      mergedAt: coarsenMonth(p.mergedAt),
      additions: bucket(p.additions),
      deletions: bucket(p.deletions),
      changedFiles: bucket(p.changedFiles),
      repo: {
        ...(keep ? { nameWithOwner: name } : {}),
        stars: bucket(p.repo.stars),
        ownerIsAuthor: p.repo.ownerIsAuthor,
        ownerType: p.repo.ownerType,
        isFork: p.repo.isFork,
      },
    };
  };
  return {
    version: 1,
    kind: "github",
    source: "sample",
    fetchedAt: s.fetchedAt,
    recordedAt: opts.recordedAt,
    label: opts.label,
    user: {
      createdAt: coarsenMonth(s.user.createdAt),
      followers: bucket(s.user.followers),
      publicRepos: bucket(s.user.publicRepos),
      commitContributionsLastYear: bucket(s.user.commitContributionsLastYear),
    },
    mergedPrs: s.mergedPrs.map(pr),
    truncated: s.truncated,
  };
}
