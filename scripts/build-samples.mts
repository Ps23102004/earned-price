// Builds data/samples/{qualifies,nearly,loophole}.json from real public GitHub accounts, anonymised.
// Run: pnpm tsx --env-file=.env scripts/build-samples.mts
// Candidates come from recent merged PRs in popular repositories; the code (not a person) decides which account
// earns which label by evaluating the *anonymised* snapshot. Prints only bucketed stats, never logins or repo names.

import { mkdirSync, writeFileSync } from "node:fs";
import { anonymiseSnapshot } from "../src/facts/anonymise";
import { fetchGithubFacts } from "../src/facts/github";
import type { GithubSnapshot } from "../src/facts/types";
import { evaluate } from "../src/rules/evaluate";
import { DEFAULT_RULE, LOOSE_RULE } from "../src/rules/presets";
import type { Rule } from "../src/rules/types";

const token = process.env.GITHUB_SERVER_TOKEN;
if (!token) {
  console.error("GITHUB_SERVER_TOKEN is not set");
  process.exit(1);
}
const BUDGET = 400; // GraphQL points
const MAX_CANDIDATES = 40;
let spent = 0;

const POOL_QUERY = `query($q: String!, $n: Int!) { rateLimit { cost remaining limit }
  search(type: REPOSITORY, first: $n, query: $q) { nodes { ... on Repository { isFork owner { login __typename }
    pullRequests(states: MERGED, first: 6, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes { additions deletions author { login __typename } } } } } } }`;

type PoolRepo = {
  isFork: boolean;
  owner: { login: string };
  pullRequests: { nodes: { additions: number; deletions: number; author: { login: string; __typename: string } | null }[] };
};

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
const stars = (range: string) => `stars:${range} pushed:>=${since} fork:false sort:updated-desc`;

const [big, mid] = [await pool(stars("1000..20000"), 15), await pool(stars("500..999"), 15)];

// Candidate lists, in the order they are tried. Round-robin so each label gets a fair share of the 40.
const isHuman = (a: { login: string; __typename: string } | null): a is { login: string; __typename: string } =>
  !!a && a.__typename === "User" && !a.login.endsWith("[bot]");
const owners: string[] = [];
const tiny: string[] = [];
const regular: string[] = [];
const nearlyPool: string[] = [];
for (const r of big) {
  for (const p of r.pullRequests.nodes) {
    if (!isHuman(p.author)) continue;
    if (p.author.login.toLowerCase() === r.owner.login.toLowerCase()) owners.push(p.author.login);
    else if (p.additions + p.deletions < 10) tiny.push(p.author.login);
    else regular.push(p.author.login);
  }
}
for (const r of mid) for (const p of r.pullRequests.nodes) if (isHuman(p.author) && p.author.login.toLowerCase() !== r.owner.login.toLowerCase()) nearlyPool.push(p.author.login);

const seen = new Set<string>();
const candidates: string[] = [];
const lists = [owners, regular, nearlyPool, tiny];
for (let i = 0; candidates.length < MAX_CANDIDATES && lists.some((l) => i < l.length); i++) {
  for (const l of lists) {
    const login = l[i];
    if (login && !seen.has(login.toLowerCase()) && candidates.length < MAX_CANDIDATES) {
      seen.add(login.toLowerCase());
      candidates.push(login);
    }
  }
}

const applied = (rule: Rule, s: GithubSnapshot) => evaluate(rule, s, new Date(recordedAt)).appliedTierId;
const t50Actual = (s: GithubSnapshot) => evaluate(DEFAULT_RULE, s, new Date(recordedAt)).tiers[0].conditions[0].actual;
const bestStarsAnyPr: Rule = {
  version: 1,
  tiers: [{ id: "x", label: "x", discountPercent: 1, conditions: [{ field: "max_repo_stars_merged_pr", op: "gte", value: 1, pr: { excludeOwnRepos: true, minLinesChanged: 10 } }] }],
};
const bestStars = (s: GithubSnapshot) => evaluate(bestStarsAnyPr, s, new Date(recordedAt)).tiers[0].conditions[0].actual;

type Label = "qualifies" | "nearly" | "loophole";
const found: Partial<Record<Label, GithubSnapshot>> = {};
let nearlyFallback: GithubSnapshot | undefined;
let loopholeFallback: GithubSnapshot | undefined;
let tried = 0;

for (const login of candidates) {
  if (found.qualifies && found.nearly && found.loophole) break;
  if (spent + 3 > BUDGET) break;
  let raw: GithubSnapshot;
  try {
    const f = await fetchGithubFacts(login, DEFAULT_RULE, { token, now });
    spent += f.rateLimit.cost;
    raw = f.snapshot;
  } catch {
    continue; // renamed, deleted or rate-limited account: just try the next one
  }
  tried++;
  const anon = (label: Label) =>
    anonymiseSnapshot(raw, { label: `sample-${label}`, recordedAt, keepRepoNames: label !== "loophole" });

  const q = anon("qualifies");
  if (!found.qualifies && applied(DEFAULT_RULE, q) === "t50") { found.qualifies = q; continue; }

  const n = anon("nearly");
  const nApplied = applied(DEFAULT_RULE, n);
  if (!found.nearly && (nApplied === "t20" || nApplied === "t10")) {
    const best = t50Actual(raw);
    if (best >= 500 && best <= 999 && t50Actual(n) === 600) { found.nearly = n; continue; }
    if (nApplied === "t20" && bestStars(raw) >= 300 && !nearlyFallback) nearlyFallback = n;
  }

  const l = anon("loophole");
  if (!found.loophole && applied(LOOSE_RULE, l) === "t50" && applied(DEFAULT_RULE, l) !== "t50") {
    if (applied(DEFAULT_RULE, l) === undefined) found.loophole = l;
    else loopholeFallback ??= l;
  }
}
found.nearly ??= nearlyFallback;
found.loophole ??= loopholeFallback;

mkdirSync(new URL("../data/samples/", import.meta.url), { recursive: true });
console.log(`candidates tried: ${tried}/${candidates.length}, GraphQL points spent: ${spent}/${BUDGET}`);
const missing: string[] = [];
for (const label of ["qualifies", "nearly", "loophole"] as const) {
  const s = found[label];
  if (!s) { missing.push(label); console.log(`${label}: NOT FOUND`); continue; }
  writeFileSync(new URL(`../data/samples/${label}.json`, import.meta.url), JSON.stringify(s, null, 2) + "\n");
  console.log(
    `${label}: DEFAULT applies ${applied(DEFAULT_RULE, s) ?? "none"}, LOOSE applies ${applied(LOOSE_RULE, s) ?? "none"}; ` +
      `age month ${s.user.createdAt.slice(0, 7)}, followers~${s.user.followers}, repos~${s.user.publicRepos}, ` +
      `commits~${s.user.commitContributionsLastYear}, merged PRs ${s.mergedPrs.length}${s.truncated ? "+ (truncated)" : ""}, ` +
      `best repo stars~${Math.max(0, ...s.mergedPrs.map((p) => p.repo.stars))}, t50 stars (DEFAULT filters)~${t50Actual(s)}`,
  );
}
if (missing.length > 0) {
  console.error(`could not find within budget: ${missing.join(", ")}`);
  process.exit(1);
}
