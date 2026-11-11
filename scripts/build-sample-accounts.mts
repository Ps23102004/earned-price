// Builds data/sample-accounts.json: ~40 anonymised snapshots of GitHub developers, for the merchant's cost preview.
// Run: pnpm tsx --env-file=.env scripts/build-sample-accounts.mts
// Frame: accounts with at least one public repository, drawn evenly from three follower bands and different account
// ages. It is a buyer-like convenience sample, not a random sample of GitHub. Prints only counts; never logins.

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
const TARGET = 42; // 14 per band
const BUDGET = 500; // GraphQL points
let spent = 0;

const POOL_QUERY = `query($q: String!, $n: Int!) { rateLimit { cost remaining limit }
  search(type: USER, first: $n, query: $q) { nodes { ... on User { login } } } }`;

async function pool(q: string, n: number): Promise<string[]> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "earned-price-demo" },
    body: JSON.stringify({ query: POOL_QUERY, variables: { q, n } }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({ errors: true }));
  if (!res.ok || json.errors) throw new Error(`pool query failed (HTTP ${res.status})`);
  spent += json.data.rateLimit.cost;
  return (json.data.search.nodes as ({ login?: string } | null)[]).map((u) => u?.login).filter((l): l is string => !!l && !l.endsWith("[bot]"));
}

const now = new Date();
const recordedAt = now.toISOString();
const bands = [
  "type:user repos:>=2 followers:0..4 created:2023-01-01..2026-10-01",
  "type:user repos:>=3 followers:5..49 created:2016-01-01..2022-12-31",
  "type:user repos:>=5 followers:50..499 created:<2020-01-01",
];
const perBand: string[][] = [];
for (const q of bands) perBand.push(await pool(q, 30));
const seen = new Set<string>();
const candidates: string[] = [];
for (let i = 0; candidates.length < TARGET * 2 && perBand.some((l) => i < l.length); i++) {
  for (const l of perBand) {
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
  JSON.stringify({ version: 1, recordedAt, frame: "GitHub developers with at least one public repository, drawn evenly from three follower bands and account ages (not a random sample of GitHub)", accounts }) + "\n",
);
const withPr = accounts.filter((a) => a.mergedPrs.length > 0).length;
console.log(`accounts: ${accounts.length}/${TARGET}, with a merged PR: ${withPr}, candidates ${candidates.length}, GraphQL points spent ${spent}/${BUDGET}`);
