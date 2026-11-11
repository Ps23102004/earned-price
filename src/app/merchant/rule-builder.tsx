"use client";

import { useState } from "react";
import { buttonClass } from "../_components/ui";

const FACTS = [
  { id: "account_age_days", label: "Account age (days)", pr: false },
  { id: "followers", label: "Followers", pr: false },
  { id: "public_repos", label: "Public repositories", pr: false },
  { id: "commit_contributions_last_year", label: "Commits in the last year", pr: false },
  { id: "merged_prs", label: "Merged pull requests", pr: true },
  { id: "max_repo_stars_merged_pr", label: "Stars of the best repo with a merged PR", pr: true },
] as const;

type Cond = { field: string; value: string; thisYear: boolean; notOwn: boolean; notForks: boolean; minLines: string };
type Tier = { label: string; percent: string; conds: Cond[] };

const newCond = (): Cond => ({ field: "followers", value: "100", thisYear: false, notOwn: false, notForks: false, minLines: "" });
const newTier = (): Tier => ({ label: "", percent: "20", conds: [newCond()] });

const field = "w-full rounded-lg border border-stone-300 bg-white p-2 text-sm dark:border-stone-700 dark:bg-stone-950";
const small = "min-h-9 rounded-lg border border-stone-300 px-3 text-xs hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800";

// The same whitelist, bounds and validator as a model's output; the server decides, this form only collects.
export function RuleBuilder({ busy, onBuild }: { busy: boolean; onBuild: (spec: unknown) => void }) {
  const [tiers, setTiers] = useState<Tier[]>([newTier()]);

  const setTier = (i: number, t: Partial<Tier>) => setTiers((all) => all.map((x, j) => (j === i ? { ...x, ...t } : x)));
  const setCond = (i: number, k: number, c: Partial<Cond>) =>
    setTiers((all) => all.map((x, j) => (j === i ? { ...x, conds: x.conds.map((y, m) => (m === k ? { ...y, ...c } : y)) } : x)));

  function submit() {
    onBuild({
      tiers: tiers.map((t, i) => ({
        label: t.label.trim() || `Tier ${i + 1}`,
        discountPercent: Number(t.percent),
        conditions: t.conds.map((c) => {
          const isPr = FACTS.find((f) => f.id === c.field)?.pr;
          return {
            field: c.field,
            value: Number(c.value),
            ...(isPr && c.thisYear ? { mergedSince: "year_start" } : {}),
            ...(isPr && c.notOwn ? { excludeOwnRepos: true } : {}),
            ...(isPr && c.notForks ? { excludeForks: true } : {}),
            ...(isPr && c.minLines.trim() !== "" ? { minLinesChanged: Number(c.minLines) } : {}),
          };
        }),
      })),
    });
  }

  return (
    <details className="mt-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
      <summary className="cursor-pointer text-sm font-medium">Or build a rule by hand (no AI needed)</summary>
      <p className="mt-2 text-xs text-stone-600 dark:text-stone-400">
        Pick facts, thresholds and a percent. The same validator that checks AI output checks this, and the best matching tier wins.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {tiers.map((t, i) => (
          <fieldset key={i} className="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
            <legend className="px-1 text-xs font-medium">Tier {i + 1}</legend>
            <div className="grid grid-cols-3 gap-2">
              <label className="col-span-2 text-xs">
                Name (optional)
                <input className={field} value={t.label} maxLength={40} onChange={(e) => setTier(i, { label: e.target.value })} />
              </label>
              <label className="text-xs">
                % off (1–90)
                <input className={field} inputMode="numeric" value={t.percent} onChange={(e) => setTier(i, { percent: e.target.value })} />
              </label>
            </div>
            {t.conds.map((c, k) => {
              const isPr = FACTS.find((f) => f.id === c.field)?.pr;
              return (
                <div key={k} className="mt-3 rounded-md bg-stone-100 p-2 dark:bg-stone-950">
                  <div className="grid grid-cols-3 gap-2">
                    <label className="col-span-2 text-xs">
                      Fact
                      <select className={field} value={c.field} onChange={(e) => setCond(i, k, { field: e.target.value })}>
                        {FACTS.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs">
                      At least
                      <input className={field} inputMode="numeric" value={c.value} onChange={(e) => setCond(i, k, { value: e.target.value })} />
                    </label>
                  </div>
                  {isPr ? (
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={c.thisYear} onChange={(e) => setCond(i, k, { thisYear: e.target.checked })} /> merged this year
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={c.notOwn} onChange={(e) => setCond(i, k, { notOwn: e.target.checked })} /> not their own repos
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={c.notForks} onChange={(e) => setCond(i, k, { notForks: e.target.checked })} /> not forks
                      </label>
                      <label className="flex items-center gap-1">
                        min lines changed
                        <input className="w-16 rounded border border-stone-300 bg-white p-1 dark:border-stone-700 dark:bg-stone-900" inputMode="numeric" value={c.minLines} onChange={(e) => setCond(i, k, { minLines: e.target.value })} />
                      </label>
                    </div>
                  ) : null}
                  {t.conds.length > 1 ? (
                    <button type="button" className={`${small} mt-2`} onClick={() => setTier(i, { conds: t.conds.filter((_, m) => m !== k) })}>
                      Remove this condition
                    </button>
                  ) : null}
                </div>
              );
            })}
            <div className="mt-3 flex flex-wrap gap-2">
              {t.conds.length < 3 ? (
                <button type="button" className={small} onClick={() => setTier(i, { conds: [...t.conds, newCond()] })}>
                  Add a condition (all must hold)
                </button>
              ) : null}
              {tiers.length > 1 ? (
                <button type="button" className={small} onClick={() => setTiers((all) => all.filter((_, j) => j !== i))}>
                  Remove tier
                </button>
              ) : null}
            </div>
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-2">
          {tiers.length < 3 ? (
            <button type="button" className={small} onClick={() => setTiers((all) => [...all, newTier()])}>
              Add a tier
            </button>
          ) : null}
          <button type="button" className={buttonClass} disabled={busy} onClick={submit}>
            Build rule
          </button>
        </div>
      </div>
    </details>
  );
}
