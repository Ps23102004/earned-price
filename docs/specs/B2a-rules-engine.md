# B2a — Pure rules engine, money helpers, canonical hashing

Part of feature B2 (F4 live price build-up). Architecture: `docs/ARCHITECTURE.md` §3.3–3.4. Everything here is **pure**: no network, no database, no model calls, no `Date.now()` except where stated, no environment variables.

## Goal
Deterministic code that turns a `Rule` and a `FactSnapshot` into a price, validates rules produced by an AI, checks that a proposed tightening is not looser, renders a plain-English read-back, converts money between integer cents and PayPal strings, and hashes snapshots canonically.

## Files
Given (do not change): `src/rules/types.ts`, `src/facts/types.ts`.
Create:
- `src/rules/validate.ts` — `validateRule(input: unknown): ValidationResult`, `isNotLooser(oldRule: Rule, newRule: Rule): boolean`
- `src/rules/evaluate.ts` — `evaluate(rule: Rule, snapshot: FactSnapshot, now?: Date): EvaluationResult`
- `src/rules/price.ts` — `price(rule: Rule, result: EvaluationResult, listCents: number): PriceResult`
- `src/rules/readback.ts` — `readback(rule: Rule): string`
- `src/paypal/money.ts` — `toPayPalValue(cents: number): string`, `fromPayPalValue(value: string): number`
- `src/facts/snapshot.ts` — `canonicalJson(value: unknown): string`, `snapshotHash(snapshot: FactSnapshot): string`
Tests live in `tests/` and import with relative paths (e.g. `../src/rules/evaluate`). Run with `pnpm test` (vitest).

## Semantics (exact)

### Time
- `DAY_MS = 86_400_000`. Ages are `Math.floor((later − earlier) / DAY_MS)` on millisecond timestamps.
- `evaluate`'s clock: the `now` argument if given; otherwise `snapshot.recordedAt` if present; otherwise `snapshot.fetchedAt`. `EvaluationResult.now` is that instant as `toISOString()`.

### Field values on a `github` snapshot
| Field | Value |
|---|---|
| `account_age_days` | `floor((now − user.createdAt) / DAY_MS)` |
| `followers` | `user.followers` |
| `public_repos` | `user.publicRepos` |
| `commit_contributions_last_year` | `user.commitContributionsLastYear` |
| `merged_prs` | number of `mergedPrs` passing the condition's `pr` filters |
| `max_repo_stars_merged_pr` | max `repo.stars` over `mergedPrs` passing the filters; `0` if none pass |

A **guest** snapshot evaluates every field to `0` (so every condition fails, since thresholds are ≥ 1).

### PR filters (all present filters must pass; absent filters don't filter)
- `minRepoStars: n` → `repo.stars >= n`
- `minLinesChanged: n` → `additions + deletions >= n`
- `excludeOwnRepos: true` → `repo.ownerIsAuthor === false` (`false` or absent = no filter)
- `excludeForks: true` → `repo.isFork === false`
- `mergedSince: "year_start"` → `mergedAt >= Jan 1 00:00:00.000 UTC of now's UTC year`; `mergedSince: "YYYY-MM-DD"` → `mergedAt >= that date 00:00 UTC`
- `minAccountAgeDaysAtMerge: n` → `floor((mergedAt − user.createdAt) / DAY_MS) >= n`

### Conditions and tiers
- A condition passes iff `actual >= value` (`op` is always `"gte"`).
- A tier passes iff **all** its conditions pass.
- `appliedTierId` = the id of the passing tier with the largest `discountPercent`; ties go to the tier that comes first in `rule.tiers`; `undefined` if no tier passes.
- `EvaluationResult.tiers` has one entry per rule tier, same order; `conditions` one entry per condition, same order, with `threshold = value`, the computed `actual`, `passed`, `pr` copied from the condition (omit if absent).
- `evidence`: for `merged_prs`, the `url`s (where defined) of the PRs that passed the filters, in snapshot order, at most 5; for `max_repo_stars_merged_pr`, the `url` of the first passing PR having the max stars (empty array if none or no url); for user fields, `[user.url]` if defined else `[]`; always `[]` on guest snapshots.

### Price
- `listCents` must be a positive integer, else throw.
- Applied tier's `discountCents = Math.floor((listCents * discountPercent + 50) / 100)` (round half up, integer math). No tier → `0`.
- `earnedCents = listCents − discountCents`.
- `lines`: one per tier in rule order: `status` `"applied"` (the applied tier, `discountCents` as above), `"superseded"` (passed but not applied, `discountCents: 0`), `"not_met"` (`discountCents: 0`).
- `price` takes the tier list from `result.tiers` and `discountPercent` from the matching tier in `rule` (by id); it throws if `result.appliedTierId` is set but no tier in `rule` has that id.

### validateRule
Returns `{ ok: true, rule }` (a clean copy) or `{ ok: false, errors }` (≥ 1 human-readable message). Rejects:
- non-object input; unknown keys at any level (rule, tier, condition, pr filters)
- `version !== 1`
- `tiers` not an array of length 1..3; duplicate tier ids
- tier `id` not matching `/^[a-z0-9_-]{1,32}$/`; `label` not a string of length 1..80
- `discountPercent` not an integer in 1..90
- `conditions` not an array of length 1..3
- `field` not in `FIELDS`; `op !== "gte"`
- `value` not an integer in `1..FIELD_MAX[field]`
- `pr` present on a field not in `PR_FIELDS`
- `minRepoStars` not an integer in 1..10_000_000; `minLinesChanged` not an integer in 1..1_000_000; `minAccountAgeDaysAtMerge` not an integer in 1..15_000; `excludeOwnRepos`/`excludeForks` not boolean; `mergedSince` not `"year_start"` and not a valid calendar date `YYYY-MM-DD` on or after `2008-01-01`.

### isNotLooser(oldRule, newRule)
`true` iff all hold (else `false`):
- same number of tiers; for each index `i`: same `id`, same `discountPercent`;
- the new tier's conditions **begin with** counterparts of every old condition in the same order (same `field`, new `value >= ` old `value`), optionally followed by extra conditions;
- for each counterpart pair, the new `pr` is at least as strict: every numeric filter present in old is present in new with a value `>=` old; every boolean filter `true` in old is `true` in new; if old has `mergedSince`, new has the identical `mergedSince`. New may add filters old lacked.
Label changes are allowed.

### readback(rule)
One line per tier, joined with `"\n"`, then a final line `Only the single best matching tier applies.`
Tier line: `` `${discountPercent}% off (${label}) if ${conditionPhrases.join(" and ")}.` ``
Numbers are formatted with `toLocaleString("en-US")` (e.g. `1,000`).
| Field | Phrase |
|---|---|
| `account_age_days` | `the GitHub account is at least N days old` |
| `followers` | `the account has at least N followers` |
| `public_repos` | `the account owns at least N public repositories` |
| `commit_contributions_last_year` | `the account made at least N commits in the last year` |
| `merged_prs` | `the account has at least N merged pull request` + (`s` unless N is 1) + filter suffix |
| `max_repo_stars_merged_pr` | `the account has a merged pull request into a repository with at least N stars` + filter suffix |
Filter suffix: empty if no filters, else `` ` (${parts.join(", ")})` `` with parts in this order, only those present/true:
`into repositories with at least N stars` · `changing at least N lines` · `not into the author's own repositories` · `not into forks` · `merged this calendar year` (year_start) or `merged on or after YYYY-MM-DD` · `when the account was at least N days old`.

Example: tier `{id:"t1", label:"core contributor", discountPercent:50, conditions:[{field:"max_repo_stars_merged_pr", op:"gte", value:1000, pr:{mergedSince:"year_start"}}]}` →
`50% off (core contributor) if the account has a merged pull request into a repository with at least 1,000 stars (merged this calendar year).`

### Money
- `toPayPalValue(cents)`: `cents` must be a non-negative safe integer, else throw. Returns `"<dollars>.<2-digit cents>"`: `0 → "0.00"`, `5 → "0.05"`, `2450 → "24.50"`, `4900 → "49.00"`, `123456 → "1234.56"`.
- `fromPayPalValue(value)`: must match `/^\d+(\.\d{1,2})?$/`, else throw. No floating-point arithmetic. `"24.50" → 2450`, `"24.5" → 2450`, `"49" → 4900`, `"0.05" → 5`. Rejects `"-1.00"`, `"1.234"`, `"1e3"`, `""`, `" 1.00"`.

### Canonical hashing
- `canonicalJson(value)`: JSON with object keys sorted recursively by default JS string order (`Object.keys(o).sort()`), no whitespace, arrays in order, object properties whose value is `undefined` omitted; throws on non-finite numbers, functions, symbols, bigint.
- `snapshotHash(snapshot)`: lowercase hex SHA-256 (`node:crypto`) of `canonicalJson(snapshot)` encoded UTF-8; 64 chars. Two snapshots differing only in key order hash equal.

## Acceptance checks
1. `pnpm test`, `pnpm typecheck`, `pnpm lint` pass.
2. The brief's example rule (50% for a merged PR into a ≥1,000-star repo this year; 20% for ≥1 merged PR; 10% for accounts ≥ 1,095 days old) on a $49.00 list price (`4900`): a buyer qualifying for all three pays `2450` (50% applied, 20% and 10% superseded); a buyer with only an old account pays `4410`; a guest pays `4900` with all tiers `not_met`.
3. A recorded snapshot (`recordedAt` set) evaluates identically regardless of the real current date.
4. `validateRule` rejects every listed invalid input; accepts the example rule.
5. `isNotLooser` accepts adding `minLinesChanged` / `excludeOwnRepos` / an extra `account_age_days` condition / raising a threshold, and rejects lowering a threshold, changing a discount, removing a condition, reordering tiers, dropping a filter.
6. Money and hashing round-trip and edge cases as listed.

## Out of scope
GitHub fetching, database, PayPal HTTP, AI calls, UI, rule storage, the loophole hunt.
