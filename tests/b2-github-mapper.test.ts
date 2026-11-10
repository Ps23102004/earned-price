// B2 GitHub mapper + fetcher (injected fetch): written from docs/specs/B2-facts-signin-price.md only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGithubFacts, toSnapshot, type GraphqlResult } from "../src/facts/github";
import { searchWindow } from "../src/facts/window";
import type { Rule } from "../src/rules/types";
import { at, cond, oneTier } from "./helpers";

const FETCHED_AT = "2026-06-15T12:00:00.000Z";
const NOW = new Date(FETCHED_AT);
const TOKEN = "ghp_SECRETTOKEN_1234567890";

type RawNode = Record<string, unknown>;

function rawNode(over: Record<string, unknown> = {}, repoOver: Record<string, unknown> = {}): RawNode {
  return {
    url: "https://github.com/acme/widgets/pull/42",
    number: 42,
    mergedAt: "2026-03-01T10:00:00Z",
    additions: 30,
    deletions: 12,
    changedFiles: 3,
    repository: {
      nameWithOwner: "acme/widgets",
      url: "https://github.com/acme/widgets",
      stargazerCount: 5400,
      isFork: false,
      owner: { login: "acme", __typename: "Organization" },
      ...repoOver,
    },
    ...over,
  };
}

function rawResult(
  over: { user?: Record<string, unknown> | null; nodes?: RawNode[]; hasNextPage?: boolean; endCursor?: string | null } = {},
): GraphqlResult {
  const user =
    over.user === null
      ? null
      : {
          databaseId: 987654,
          createdAt: "2019-08-23T17:45:12Z",
          followers: { totalCount: 37 },
          repositories: { totalCount: 12 },
          contributionsCollection: { totalCommitContributions: 640 },
          url: "https://github.com/octo",
          ...over.user,
        };
  return {
    rateLimit: { cost: 1, remaining: 4999, limit: 5000 },
    user,
    search: {
      issueCount: (over.nodes ?? [rawNode()]).length,
      pageInfo: { hasNextPage: over.hasNextPage ?? false, endCursor: over.endCursor ?? null },
      nodes: over.nodes ?? [rawNode()],
    },
  } as unknown as GraphqlResult;
}

describe("toSnapshot", () => {
  it("maps user fields and returns databaseId", () => {
    const { snapshot, databaseId } = toSnapshot(rawResult(), "octo", FETCHED_AT, false);
    expect(databaseId).toBe(987654);
    expect(snapshot.version).toBe(1);
    expect(snapshot.kind).toBe("github");
    expect(snapshot.source).toBe("live");
    expect(snapshot.fetchedAt).toBe(FETCHED_AT);
    expect(snapshot.user.login).toBe("octo");
    expect(snapshot.user.url).toBe("https://github.com/octo");
    expect(snapshot.user.createdAt).toBe("2019-08-23T17:45:12Z");
    expect(snapshot.user.followers).toBe(37);
    expect(snapshot.user.publicRepos).toBe(12);
    expect(snapshot.user.commitContributionsLastYear).toBe(640);
  });

  it("maps merged PR fields", () => {
    const { snapshot } = toSnapshot(rawResult(), "octo", FETCHED_AT, false);
    expect(snapshot.mergedPrs).toHaveLength(1);
    const pr = at(snapshot.mergedPrs, 0);
    expect(pr.url).toBe("https://github.com/acme/widgets/pull/42");
    expect(pr.number).toBe(42);
    expect(pr.mergedAt).toBe("2026-03-01T10:00:00Z");
    expect(pr.additions).toBe(30);
    expect(pr.deletions).toBe(12);
    expect(pr.changedFiles).toBe(3);
    expect(pr.repo.nameWithOwner).toBe("acme/widgets");
    expect(pr.repo.url).toBe("https://github.com/acme/widgets");
    expect(pr.repo.stars).toBe(5400);
    expect(pr.repo.isFork).toBe(false);
    expect(pr.repo.ownerLogin).toBe("acme");
    expect(pr.repo.ownerType).toBe("Organization");
    expect(pr.repo.ownerIsAuthor).toBe(false);
  });

  it("ownerIsAuthor is a case-insensitive login comparison", () => {
    const own = (ownerLogin: string, login: string) =>
      at(
        toSnapshot(rawResult({ nodes: [rawNode({}, { owner: { login: ownerLogin, __typename: "User" } })] }), login, FETCHED_AT, false)
          .snapshot.mergedPrs,
        0,
      ).repo.ownerIsAuthor;
    expect(own("octo", "octo")).toBe(true);
    expect(own("Octo", "octo")).toBe(true);
    expect(own("octo", "OCTO")).toBe(true);
    expect(own("OcTo", "oCtO")).toBe(true);
    expect(own("octo-org", "octo")).toBe(false);
    expect(own("octo", "octo2")).toBe(false);
  });

  it("ownerType comes from the owner __typename", () => {
    const type = (t: string) =>
      at(
        toSnapshot(rawResult({ nodes: [rawNode({}, { owner: { login: "x", __typename: t } })] }), "octo", FETCHED_AT, false)
          .snapshot.mergedPrs,
        0,
      ).repo.ownerType;
    expect(type("User")).toBe("User");
    expect(type("Organization")).toBe("Organization");
  });

  it("isFork is mapped for forks", () => {
    const { snapshot } = toSnapshot(rawResult({ nodes: [rawNode({}, { isFork: true })] }), "octo", FETCHED_AT, false);
    expect(at(snapshot.mergedPrs, 0).repo.isFork).toBe(true);
  });

  it("passes the truncated flag through in both directions", () => {
    expect(toSnapshot(rawResult(), "octo", FETCHED_AT, true).snapshot.truncated).toBe(true);
    expect(toSnapshot(rawResult(), "octo", FETCHED_AT, false).snapshot.truncated).toBe(false);
  });

  it("keeps PR order and handles several PRs", () => {
    const nodes = [1, 2, 3].map((n) => rawNode({ number: n, url: `https://github.com/acme/widgets/pull/${n}` }));
    const { snapshot } = toSnapshot(rawResult({ nodes }), "octo", FETCHED_AT, false);
    expect(snapshot.mergedPrs.map((p) => p.number)).toEqual([1, 2, 3]);
  });

  it("zero PRs -> empty mergedPrs", () => {
    expect(toSnapshot(rawResult({ nodes: [] }), "octo", FETCHED_AT, false).snapshot.mergedPrs).toEqual([]);
  });

  it("null user throws", () => {
    expect(() => toSnapshot(rawResult({ user: null }), "octo", FETCHED_AT, false)).toThrow();
  });

  it("does not mutate the raw input", () => {
    const raw = rawResult();
    const before = structuredClone(raw);
    toSnapshot(raw, "octo", FETCHED_AT, false);
    expect(raw).toEqual(before);
  });
});

// ---- fetchGithubFacts -------------------------------------------------------

type Call = { url: string; init: RequestInit; body: string };

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
}

function dataFrom(raw: GraphqlResult, withSearch = true): Record<string, unknown> {
  const { search, ...rest } = raw as unknown as Record<string, unknown>;
  return withSearch ? { ...rest, search } : rest;
}

function makeFetch(respond: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const call: Call = {
      url: typeof input === "string" ? input : String((input as { url?: string }).url ?? input),
      init: init ?? {},
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    return respond(call, calls.length);
  });
  return { impl: impl as unknown as typeof fetch, mock: impl, calls };
}

let seq = 0;
/** Unique valid login per test: the fetcher keeps a module-level cache. */
function uniq(): string {
  seq += 1;
  return `ep-user-${seq}`;
}

const prRule: Rule = oneTier(cond("max_repo_stars_merged_pr", 1000, { mergedSince: "year_start" }));
const undatedPrRule: Rule = oneTier(cond("merged_prs", 1));
const noPrRule: Rule = oneTier([cond("followers", 5), cond("account_age_days", 100)]);

function hdr(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

describe("fetchGithubFacts: validation", () => {
  it.each([
    [""],
    ["-leading"],
    ["has_underscore"],
    ["has space"],
    ["octo\n"],
    ["octo/../x"],
    ['octo"){x'],
    ["a".repeat(40)],
    ["ünïcode"],
    ["octo.cat"],
  ])("rejects invalid login %j before any request", async (login) => {
    const { impl, mock } = makeFetch(() => ok(dataFrom(rawResult())));
    await expect(fetchGithubFacts(login, prRule, { token: TOKEN, now: NOW, fetchImpl: impl })).rejects.toThrow("invalid login");
    expect(mock).not.toHaveBeenCalled();
  });

  it.each([["a"], ["octo-cat"], ["a".repeat(39)], ["Octo123"], ["abc-"], ["a--b"]])("accepts valid login %j", async (login) => {
    const { impl, mock } = makeFetch(() => ok(dataFrom(rawResult())));
    await expect(fetchGithubFacts(login, prRule, { token: TOKEN, now: NOW, fetchImpl: impl })).resolves.toBeDefined();
    expect(mock).toHaveBeenCalled();
  });
});

describe("fetchGithubFacts: request shape", () => {
  it("sends Authorization: Bearer <token> and a timeout signal", async () => {
    const { impl, calls } = makeFetch(() => ok(dataFrom(rawResult())));
    await fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: NOW, fetchImpl: impl });
    const call = at(calls, 0);
    expect(hdr(call.init, "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("the search query is is:pr is:merged author:<login> ... sort:created-desc", async () => {
    const login = uniq();
    const { impl, calls } = makeFetch(() => ok(dataFrom(rawResult())));
    await fetchGithubFacts(login, prRule, { token: TOKEN, now: NOW, fetchImpl: impl });
    const body = at(calls, 0).body;
    expect(body).toContain(`is:pr is:merged author:${login}`);
    expect(body).toContain("sort:created-desc");
  });

  it("query contains merged:>=<date> exactly when searchWindow gives a date (year_start)", async () => {
    const win = searchWindow(prRule, NOW);
    expect(win).toEqual({ needsPrs: true, mergedSince: "2026-01-01" });
    const { impl, calls } = makeFetch(() => ok(dataFrom(rawResult())));
    await fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: NOW, fetchImpl: impl });
    expect(at(calls, 0).body).toContain("merged:>=2026-01-01");
  });

  it("year_start follows the injected now (UTC year)", async () => {
    const { impl, calls } = makeFetch(() => ok(dataFrom(rawResult())));
    await fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: new Date("2027-01-01T00:00:00.000Z"), fetchImpl: impl });
    expect(at(calls, 0).body).toContain("merged:>=2027-01-01");
  });

  it("an explicit mergedSince date is used verbatim", async () => {
    const rule = oneTier(cond("merged_prs", 1, { mergedSince: "2025-04-05" }));
    const { impl, calls } = makeFetch(() => ok(dataFrom(rawResult())));
    await fetchGithubFacts(uniq(), rule, { token: TOKEN, now: NOW, fetchImpl: impl });
    expect(at(calls, 0).body).toContain("merged:>=2025-04-05");
  });

  it("no merged:>= qualifier when a PR condition has no mergedSince", async () => {
    expect(searchWindow(undatedPrRule, NOW)).toEqual({ needsPrs: true });
    const { impl, calls } = makeFetch(() => ok(dataFrom(rawResult())));
    await fetchGithubFacts(uniq(), undatedPrRule, { token: TOKEN, now: NOW, fetchImpl: impl });
    expect(at(calls, 0).body).not.toContain("merged:>=");
    expect(at(calls, 0).body).toContain("is:pr is:merged");
  });
});

describe("fetchGithubFacts: result", () => {
  it("returns a live snapshot, databaseId and rateLimit cost/remaining", async () => {
    const login = uniq();
    const { impl } = makeFetch(() => ok(dataFrom(rawResult())));
    const out = await fetchGithubFacts(login, prRule, { token: TOKEN, now: NOW, fetchImpl: impl });
    expect(out.databaseId).toBe(987654);
    expect(out.rateLimit.cost).toBe(1);
    expect(out.rateLimit.remaining).toBe(4999);
    expect(out.snapshot.kind).toBe("github");
    expect(out.snapshot.source).toBe("live");
    expect(out.snapshot.user.followers).toBe(37);
    expect(out.snapshot.truncated).toBe(false);
    expect(out.snapshot.mergedPrs).toHaveLength(1);
  });

  it("ownerIsAuthor uses the requested login, case-insensitively", async () => {
    const login = uniq();
    const node = rawNode({}, { owner: { login: login.toUpperCase(), __typename: "User" } });
    const { impl } = makeFetch(() => ok(dataFrom(rawResult({ nodes: [node] }))));
    const out = await fetchGithubFacts(login, prRule, { token: TOKEN, now: NOW, fetchImpl: impl });
    expect(at(out.snapshot.mergedPrs, 0).repo.ownerIsAuthor).toBe(true);
  });
});

describe("fetchGithubFacts: search skipped when the rule needs no PRs", () => {
  it("makes exactly one request and sends no PR search", async () => {
    const { impl, mock, calls } = makeFetch(() => ok(dataFrom(rawResult({ nodes: [] }), false)));
    const out = await fetchGithubFacts(uniq(), noPrRule, { token: TOKEN, now: NOW, fetchImpl: impl });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(at(calls, 0).body).not.toContain("is:pr");
    expect(at(calls, 0).body).not.toContain("merged:>=");
    expect(out.snapshot.mergedPrs).toEqual([]);
    expect(out.snapshot.truncated).toBe(false);
    expect(out.databaseId).toBe(987654);
  });

  it("the same rule that needs PRs does send the search", async () => {
    const { impl, calls } = makeFetch(() => ok(dataFrom(rawResult())));
    await fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: NOW, fetchImpl: impl });
    expect(at(calls, 0).body).toContain("is:pr");
  });
});

describe("fetchGithubFacts: pagination", () => {
  function paged(pages: number, alwaysMore: boolean) {
    return makeFetch((call, n) => {
      const last = n >= pages;
      const hasNextPage = alwaysMore ? true : !last;
      return ok(
        dataFrom(
          rawResult({
            nodes: [rawNode({ number: n, url: `https://github.com/acme/widgets/pull/${n}` })],
            hasNextPage,
            endCursor: `CURSOR${n}`,
          }),
        ),
      );
    });
  }

  it("follows hasNextPage and sends the previous endCursor as the after cursor", async () => {
    const { impl, mock, calls } = paged(2, false);
    const out = await fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: NOW, fetchImpl: impl });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(at(calls, 0).body).not.toContain("CURSOR1");
    expect(at(calls, 1).body).toContain("CURSOR1");
    expect(out.snapshot.mergedPrs.map((p) => p.number)).toEqual([1, 2]);
    expect(out.snapshot.truncated).toBe(false);
  });

  it("stops at maxPages and flags truncated when more pages remain", async () => {
    const { impl, mock, calls } = paged(10, true);
    const out = await fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: NOW, fetchImpl: impl, maxPages: 2 });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(at(calls, 1).body).toContain("CURSOR1");
    expect(out.snapshot.truncated).toBe(true);
    expect(out.snapshot.mergedPrs).toHaveLength(2);
  });

  it("maxPages 1 makes a single request", async () => {
    const { impl, mock } = paged(10, true);
    const out = await fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: NOW, fetchImpl: impl, maxPages: 1 });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(out.snapshot.truncated).toBe(true);
  });

  it("defaults maxPages to 3", async () => {
    const { impl, mock } = paged(10, true);
    const out = await fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: NOW, fetchImpl: impl });
    expect(mock).toHaveBeenCalledTimes(3);
    expect(out.snapshot.truncated).toBe(true);
    expect(out.snapshot.mergedPrs).toHaveLength(3);
  });

  it("not truncated when the last allowed page reports hasNextPage false", async () => {
    const { impl, mock } = paged(2, false);
    const out = await fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: NOW, fetchImpl: impl, maxPages: 2 });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(out.snapshot.truncated).toBe(false);
  });

  it("every page carries the Bearer token", async () => {
    const { impl, calls } = paged(3, false);
    await fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: NOW, fetchImpl: impl });
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(hdr(c.init, "authorization")).toBe(`Bearer ${TOKEN}`);
  });
});

describe("fetchGithubFacts: errors never leak the token", () => {
  async function failure(response: () => Response | Promise<Response>): Promise<Error> {
    const { impl } = makeFetch(response);
    try {
      await fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: NOW, fetchImpl: impl });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      return e as Error;
    }
    throw new Error("expected fetchGithubFacts to throw");
  }

  it("HTTP 500 throws without the token, even if the body echoes it", async () => {
    const e = await failure(() => new Response(`server exploded; token was ${TOKEN}`, { status: 500 }));
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).not.toContain("SECRETTOKEN");
  });

  it("HTTP 401 / 403 / 502 throw", async () => {
    for (const status of [401, 403, 502]) {
      const e = await failure(() => new Response(JSON.stringify({ message: `Bad credentials ${TOKEN}` }), { status }));
      expect(e.message).not.toContain(TOKEN);
    }
  });

  it("an errors array (HTTP 200) throws without the token", async () => {
    const e = await failure(
      () =>
        new Response(JSON.stringify({ errors: [{ message: `Bad credentials for ${TOKEN}`, type: "FORBIDDEN" }] }), {
          status: 200,
        }),
    );
    expect(e.message).not.toContain(TOKEN);
  });

  it("an errors array alongside partial data still throws", async () => {
    await failure(
      () => new Response(JSON.stringify({ data: dataFrom(rawResult()), errors: [{ message: "partial failure" }] }), { status: 200 }),
    );
  });

  it("user: null (no such user) throws", async () => {
    const e = await failure(() => ok(dataFrom(rawResult({ user: null }))));
    expect(e.message).not.toContain(TOKEN);
  });

  it("a network failure rejects", async () => {
    const { impl } = makeFetch(() => Promise.reject(new TypeError("network down")));
    await expect(fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: NOW, fetchImpl: impl })).rejects.toThrow();
  });

  it("a non-JSON 200 body rejects", async () => {
    const { impl } = makeFetch(() => new Response("<html>oops</html>", { status: 200 }));
    await expect(fetchGithubFacts(uniq(), prRule, { token: TOKEN, now: NOW, fetchImpl: impl })).rejects.toThrow();
  });
});

describe("fetchGithubFacts: 10 minute cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FETCHED_AT));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const MIN = 60_000;
  // `now` is deliberately not injected here: the TTL is measured on the (fake) wall clock, and
  // the window date then also derives from it (2026-01-01 for year_start).

  it("a second identical call within 10 minutes makes no new request and returns the same snapshot", async () => {
    const login = uniq();
    const { impl, mock } = makeFetch(() => ok(dataFrom(rawResult())));
    const a = await fetchGithubFacts(login, prRule, { token: TOKEN, fetchImpl: impl });
    expect(mock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(NOW.getTime() + 9 * MIN + 59_000));
    const b = await fetchGithubFacts(login, prRule, { token: TOKEN, fetchImpl: impl });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(b.snapshot).toEqual(a.snapshot);
    expect(b.databaseId).toBe(a.databaseId);
  });

  it("expires after 10 minutes and refetches", async () => {
    const login = uniq();
    const { impl, mock } = makeFetch(() => ok(dataFrom(rawResult())));
    await fetchGithubFacts(login, prRule, { token: TOKEN, fetchImpl: impl });
    vi.setSystemTime(new Date(NOW.getTime() + 10 * MIN + 1000));
    await fetchGithubFacts(login, prRule, { token: TOKEN, fetchImpl: impl });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("different logins are cached independently", async () => {
    const { impl, mock } = makeFetch(() => ok(dataFrom(rawResult())));
    await fetchGithubFacts(uniq(), prRule, { token: TOKEN, fetchImpl: impl });
    await fetchGithubFacts(uniq(), prRule, { token: TOKEN, fetchImpl: impl });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("the key includes mergedSince: a rule with another window misses the cache", async () => {
    const login = uniq();
    const { impl, mock } = makeFetch(() => ok(dataFrom(rawResult())));
    await fetchGithubFacts(login, prRule, { token: TOKEN, fetchImpl: impl }); // 2026-01-01
    await fetchGithubFacts(login, oneTier(cond("merged_prs", 1, { mergedSince: "2025-01-01" })), {
      token: TOKEN,
      fetchImpl: impl,
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("the key includes needsPrs: PR and non-PR rules for one login do not share an entry", async () => {
    const login = uniq();
    const { impl, mock } = makeFetch(() => ok(dataFrom(rawResult())));
    await fetchGithubFacts(login, prRule, { token: TOKEN, fetchImpl: impl });
    await fetchGithubFacts(login, noPrRule, { token: TOKEN, fetchImpl: impl });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("two different rules with the same window share a cache entry", async () => {
    const login = uniq();
    const { impl, mock } = makeFetch(() => ok(dataFrom(rawResult())));
    await fetchGithubFacts(login, prRule, { token: TOKEN, fetchImpl: impl });
    await fetchGithubFacts(login, oneTier(cond("merged_prs", 5, { mergedSince: "year_start" }), 30, "other"), {
      token: TOKEN,
      fetchImpl: impl,
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
