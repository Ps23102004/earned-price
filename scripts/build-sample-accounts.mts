// Builds data/sample-accounts.json: ~40 anonymised snapshots of recent contributors, for the merchant's cost preview.
// Run: pnpm tsx --env-file=.env scripts/build-sample-accounts.mts
// Frame: authors of recently merged PRs in public repositories of mixed popularity (not a random sample of GitHub).
// Prints only counts; never logins or repository names.

import { writeFileSync } from "node:fs";
import { anonymiseSnapshot } from "../src/facts/anonymise";
import { fetchGithubFacts } from "../src/facts/github";
import type { GithubSnapshot } from "../src/facts/types";
import { DEFAULT_RULE } from "../src/rules/presets";

const token = process.env.GITHUB_SERVER_TOKEN;
if (!token) {
  console.error("GITHUB_SERVER_TOKEN is not set");
  process.exit(1);
}
const TARGET = 40;
const BUDGET = 400; // GraphQL points
let spent = 0;

const POOL_QUERY = `query($q: String!, $n: Int!) { rateLimit { cost remaining limit }
  search(type: REPOSITORY, first: $n, query: $q) { nodes { ... on Repository { owner { login }
    pullRequests(states: MERGED, first: 6, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { author { login __typename } } } } } } }`;
type PoolRepo = { owner: { login: string }; pullRequests: { nodes: { author: { login: string; __typename: string } | null }[] } };

async function pool(q: string, n: number): Promise<PoolRepo[]> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "earned-price-demo" },
    body: JSON.stringify({ query: POOL_QUERY, variables: { q, n } }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({ errors: true }));
  if (!res.ok || json.errors) throw new Error(`pool query failed (HTTP ${res.status})`);
  spent += json.data.rateLimit.cost;
  return json.data.search.nodes.filter((r: PoolRepo | null) => r && r.pullRequests);
}

const now = new Date();
const recordedAt = now.toISOString();
const since = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
const frames = ["1000..20000", "200..999", "30..199"].map((r) => `stars:${r} pushed:>=${since} fork:false sort:updated-desc`);
const lists: string[][] = [];
for (const q of frames) {
  const logins: string[] = [];
  for (const r of await pool(q, 20)) {
    for (const p of r.pullRequests.nodes) {
      const a = p.author;
      if (a && a.__typename === "User" && !a.login.endsWith("[bot]")) logins.push(a.login); // repository owners are kept: the self-merge loophole must be represented in the sample
    }
  }
  lists.push(logins);
}
const seen = new Set<string>();
const candidates: string[] = [];
for (let i = 0; candidates.length < TARGET * 2 && lists.some((l) => i < l.length); i++) {
  for (const l of lists) {
    const login = l[i];
    if (login && !seen.has(login.toLowerCase())) {
      seen.add(login.toLowerCase());
      candidates.push(login);
    }
  }
}

const accounts: GithubSnapshot[] = [];
for (const login of candidates) {
  if (accounts.length >= TARGET || spent + 4 > BUDGET) break;
  try {
    const f = await fetchGithubFacts(login, DEFAULT_RULE, { token, now });
    spent += f.rateLimit.cost;
    accounts.push(anonymiseSnapshot(f.snapshot, { label: "sample-account", recordedAt, keepRepoNames: false }));
  } catch {
    /* renamed, deleted or rate-limited: next */
  }
}
writeFileSync(
  new URL("../data/sample-accounts.json", import.meta.url),
  JSON.stringify({ version: 1, recordedAt, frame: "authors of recently merged pull requests in public repositories of mixed popularity (not a random sample of GitHub)", accounts }) + "\n",
);
console.log(`accounts: ${accounts.length}/${TARGET}, candidates ${candidates.length}, GraphQL points spent ${spent}/${BUDGET}`);
