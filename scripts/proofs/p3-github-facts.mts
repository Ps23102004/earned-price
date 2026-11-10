// Proof P3: one GraphQL call with the server token returns merged PRs (with merged:>= and sort) plus repo owner and stars.
// Run: pnpm tsx --env-file=.env scripts/proofs/p3-github-facts.mts [login]
import { appendFileSync } from "node:fs";

const login = process.argv[2] ?? "gaearon";
const since = `${new Date().getUTCFullYear()}-01-01`;
const query = `query($login: String!, $q: String!) {
  rateLimit { cost remaining limit }
  user(login: $login) { databaseId createdAt followers { totalCount } repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount } }
  search(type: ISSUE, first: 100, query: $q) {
    issueCount
    nodes { ... on PullRequest { url number mergedAt additions deletions changedFiles
      repository { nameWithOwner stargazerCount isFork owner { login __typename } } } }
  }
}`;
const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.GITHUB_SERVER_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query, variables: { login, q: `is:pr is:merged author:${login} merged:>=${since} sort:created-desc` } }),
  signal: AbortSignal.timeout(15_000),
});
const body = await res.json();
if (body.errors || !body.data) {
  console.error("FAIL", res.status, JSON.stringify(body.errors ?? body).slice(0, 500));
  process.exit(1);
}
const { rateLimit, user, search } = body.data;
const prs = search.nodes.filter((n: { url?: string }) => n.url);
const allSince = prs.every((p: { mergedAt: string }) => p.mergedAt >= since);
const top = [...prs].sort((a, b) => b.repository.stargazerCount - a.repository.stargazerCount)[0];
const checks = {
  "user databaseId + createdAt present": Boolean(user?.databaseId && user?.createdAt),
  "search returned merged PRs": prs.length > 0,
  "merged:>= honoured (every mergedAt >= Jan 1)": allSince,
  "PR has repository.owner.login + stargazerCount": Boolean(top?.repository?.owner?.login && typeof top.repository.stargazerCount === "number"),
  "rateLimit.cost <= 5": rateLimit.cost <= 5,
};
console.log(JSON.stringify({ login, since, rateLimit, issueCount: search.issueCount, prsReturned: prs.length,
  topRepo: top && { nameWithOwner: top.repository.nameWithOwner, stars: top.repository.stargazerCount, owner: top.repository.owner } }, null, 2));
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"}  ${k}`);
const pass = Object.values(checks).every(Boolean);
appendFileSync("docs/EVIDENCE.md", `| ${new Date().toISOString().slice(0, 16)}Z | P3 GitHub facts query (server token) | POST /graphql user + search "is:pr is:merged author:${login} merged:>=${since} sort:created-desc" + rateLimit | user ${login} (databaseId ${user.databaseId}) | ${prs.length} PRs returned of ${search.issueCount}; top repo ${top?.repository.nameWithOwner} ${top?.repository.stargazerCount}★ owner ${top?.repository.owner.login} (${top?.repository.owner.__typename}); cost ${rateLimit.cost}, remaining ${rateLimit.remaining}/${rateLimit.limit} | ${pass ? "PASS" : "FAIL"} |\n`);
process.exit(pass ? 0 : 2);
