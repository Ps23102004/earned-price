// Public GitHub facts for one login: pure GraphQL-to-snapshot mapper plus a fetcher with an injectable fetch.
// The token only ever travels in the Authorization header; no error message contains it.

import type { Rule } from "../rules/types";
import { searchWindow } from "./window";
import type { GithubSnapshot, MergedPr } from "./types";

type RawPr = {
  url: string;
  number: number;
  mergedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  repository: {
    nameWithOwner: string;
    url: string;
    stargazerCount: number;
    isFork: boolean;
    owner: { login: string; __typename: string };
  };
};

export type GraphqlResult = {
  rateLimit: { cost: number; remaining: number; limit: number };
  user: {
    databaseId: number;
    createdAt: string;
    url: string;
    followers: { totalCount: number };
    repositories: { totalCount: number };
    contributionsCollection: { totalCommitContributions: number };
  } | null;
  search?: {
    issueCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: (Partial<RawPr> | null)[];
  };
};

type Facts = { snapshot: GithubSnapshot; databaseId: number };

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function toSnapshot(raw: GraphqlResult, login: string, fetchedAt: string, truncated: boolean): Facts {
  const u = raw.user;
  if (!u) throw new Error("GitHub user not found");
  const mergedPrs = (raw.search?.nodes ?? []).flatMap((n): MergedPr[] => {
    if (!n || !n.repository || typeof n.mergedAt !== "string") return []; // non-PR search nodes are empty objects
    const r = n.repository;
    return [
      {
        url: n.url,
        number: n.number,
        mergedAt: n.mergedAt,
        additions: n.additions ?? 0,
        deletions: n.deletions ?? 0,
        changedFiles: n.changedFiles ?? 0,
        repo: {
          nameWithOwner: r.nameWithOwner,
          url: r.url,
          stars: r.stargazerCount,
          ownerLogin: r.owner.login,
          ownerIsAuthor: r.owner.login.toLowerCase() === login.toLowerCase(),
          ownerType: r.owner.__typename === "Organization" ? "Organization" : "User",
          isFork: r.isFork,
        },
      },
    ];
  });
  return {
    databaseId: u.databaseId,
    snapshot: {
      version: 1,
      kind: "github",
      source: "live",
      fetchedAt,
      user: {
        login,
        url: u.url,
        createdAt: u.createdAt,
        followers: u.followers.totalCount,
        publicRepos: u.repositories.totalCount,
        commitContributionsLastYear: u.contributionsCollection.totalCommitContributions,
      },
      mergedPrs,
      truncated,
    },
  };
}

const USER_PART = `user(login: $login) { databaseId createdAt url followers { totalCount }
  repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
  contributionsCollection { totalCommitContributions } }`;
const SEARCH_PART = `search(type: ISSUE, first: 100, after: $cursor, query: $q) { issueCount
  pageInfo { hasNextPage endCursor }
  nodes { ... on PullRequest { url number mergedAt additions deletions changedFiles
    repository { nameWithOwner url stargazerCount isFork owner { login __typename } } } } }`;

function buildQuery(withUser: boolean, withSearch: boolean): string {
  const vars = ["$login: String!", ...(withSearch ? ["$q: String!", "$cursor: String"] : [])];
  // A GraphQL variable that is declared but unused is an error, so declare only what this request uses.
  if (!withUser) vars.shift();
  return `query(${vars.join(", ")}) { rateLimit { cost remaining limit } ${withUser ? USER_PART : ""} ${withSearch ? SEARCH_PART : ""} }`;
}

async function post(fetchImpl: typeof fetch, token: string, query: string, variables: object): Promise<GraphqlResult> {
  let res: Response;
  try {
    res = await fetchImpl("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "earned-price-demo" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("GitHub request failed");
  }
  if (res.status !== 200) throw new Error(`GitHub responded with HTTP ${res.status}`);
  const json = (await res.json().catch(() => null)) as { data?: GraphqlResult; errors?: { message?: string }[] } | null;
  if (!json) throw new Error("GitHub returned an unreadable response");
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error("GitHub reported an error"); // GitHub's own message may echo credentials, so it is dropped
  }
  if (!json.data) throw new Error("GitHub returned no data");
  return json.data;
}

const TTL_MS = 600_000;
const MAX_CACHED = 500;
type Fetched = Facts & { rateLimit: { cost: number; remaining: number } };
const cache = new Map<string, { at: number; value: Fetched }>();

export function _clearCacheForTests(): void {
  cache.clear();
}

export async function fetchGithubFacts(
  login: string,
  rule: Rule,
  opts: { token: string; now?: Date; fetchImpl?: typeof fetch; maxPages?: number },
): Promise<Fetched> {
  if (!LOGIN.test(login)) throw new Error("invalid login");
  const now = opts.now ?? new Date();
  const { needsPrs, mergedSince } = searchWindow(rule, now);
  const key = `${login.toLowerCase()}|${mergedSince ?? ""}|${needsPrs}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < TTL_MS) {
    return { ...hit.value, rateLimit: { cost: 0, remaining: hit.value.rateLimit.remaining } };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxPages = Math.max(1, opts.maxPages ?? 3);
  const q = `is:pr is:merged author:${login}${mergedSince ? ` merged:>=${mergedSince}` : ""} sort:created-desc`;
  let raw: GraphqlResult | undefined;
  let nodes: NonNullable<GraphqlResult["search"]>["nodes"] = [];
  let hasNext = false;
  let cursor: string | null = null;
  let cost = 0;
  let remaining = 0;
  for (let page = 0; page < (needsPrs ? maxPages : 1); page++) {
    const withUser = page === 0;
    const data = await post(fetchImpl, opts.token, buildQuery(withUser, needsPrs), {
      ...(withUser ? { login } : {}),
      ...(needsPrs ? { q, cursor } : {}),
    });
    if (withUser) {
      if (!data.user) throw new Error("GitHub user not found");
      raw = data;
    }
    cost += data.rateLimit?.cost ?? 0;
    remaining = data.rateLimit?.remaining ?? remaining;
    if (needsPrs && data.search) {
      nodes = nodes.concat(data.search.nodes ?? []);
      hasNext = data.search.pageInfo.hasNextPage;
      cursor = data.search.pageInfo.endCursor;
      if (!hasNext) break;
    }
  }
  if (!raw?.user) throw new Error("GitHub user not found");
  const facts = toSnapshot(
    { rateLimit: { cost, remaining, limit: raw.rateLimit?.limit ?? 0 }, user: raw.user, ...(needsPrs ? { search: { issueCount: nodes.length, pageInfo: { hasNextPage: hasNext, endCursor: cursor }, nodes } } : {}) },
    login,
    now.toISOString(),
    needsPrs && hasNext,
  );
  const value: Fetched = { ...facts, rateLimit: { cost, remaining } };
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: now.getTime(), value });
  return value;
}
