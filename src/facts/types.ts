// Snapshot of the public facts a price was computed from. Pure data, no I/O.

import type { IsoDateTime } from "../rules/types";

export type MergedPr = {
  url?: string;
  number?: number;
  mergedAt: IsoDateTime;
  additions: number;
  deletions: number;
  changedFiles: number;
  repo: {
    nameWithOwner?: string;
    url?: string;
    stars: number;
    ownerLogin?: string;
    ownerIsAuthor: boolean;
    ownerType: "User" | "Organization";
    isFork: boolean;
  };
};

export type GuestSnapshot = { version: 1; kind: "guest"; fetchedAt: IsoDateTime };

export type GithubSnapshot = {
  version: 1;
  kind: "github";
  source: "live" | "sample";
  fetchedAt: IsoDateTime;
  /** Set on recorded snapshots (samples, cached counterexamples): evaluation clock is frozen here. */
  recordedAt?: IsoDateTime;
  label?: string;
  user: {
    login?: string;
    url?: string;
    createdAt: IsoDateTime;
    followers: number;
    publicRepos: number;
    commitContributionsLastYear: number;
  };
  mergedPrs: MergedPr[];
  truncated: boolean;
};

export type FactSnapshot = GuestSnapshot | GithubSnapshot;
