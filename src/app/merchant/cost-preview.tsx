"use client";

import { useEffect, useState } from "react";
import { Chip } from "../_components/ui";

type Core = { n: number; sharePercent: number; averageDiscountPercent: number; giveawayPer1000Cents: number };
type Preview = {
  before?: Core;
  n: number;
  qualifying: number;
  sharePercent: number;
  averageDiscountPercent: number;
  giveawayPer1000Cents: number;
  tiers: { tierId: string; label: string; discountPercent: number; count: number }[];
  summary: string;
  recordedAt: string;
  frame: string;
};

// What would this rule cost? Code runs the rule over a recorded sample; no model and no live GitHub call.
export function CostPreview({ ruleId, compareRuleId }: { ruleId: string; compareRuleId?: string }) {
  const [state, setState] = useState<{ ruleId: string; preview?: Preview; failed?: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/merchant/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(compareRuleId ? { ruleId, compareRuleId } : { ruleId }) })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        setState(res.ok && json && typeof json.summary === "string" ? { ruleId, preview: json } : { ruleId, failed: true });
      })
      .catch(() => {
        if (!cancelled) setState({ ruleId, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [ruleId, compareRuleId]);

  const shown = state?.ruleId === ruleId ? state : null;
  return (
    <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Cost preview</h3>
        <Chip tone="info">code-computed · recorded sample</Chip>
      </div>
      {shown?.preview ? (
        <>
          <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">Not representative of your customers: this sample is people who recently had a pull request merged.</p>
          <p className="mt-1 text-sm">{shown.preview.summary}</p>
          {shown.preview.sharePercent > 50 ? (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
              Heads up: most of this sample ({shown.preview.sharePercent}%) would get a discount, so this works like a blanket price cut. Raise the thresholds if that is not what you want.
            </p>
          ) : null}
          <p className="mt-2 text-sm">
            If buyers looked like this sample, this rule gives away about{" "}
            <strong className="font-mono">${Math.round(shown.preview.giveawayPer1000Cents / 100).toLocaleString("en-US")}</strong> per 1,000 sales at the $49.00 list price.
          </p>
          {shown.preview.before ? (
            <table className="mt-2 w-full text-left text-xs">
              <caption className="sr-only">Before and after tightening</caption>
              <thead>
                <tr className="text-stone-500 dark:text-stone-400">
                  <th scope="col" className="py-1 font-medium"></th>
                  <th scope="col" className="py-1 font-medium">Before</th>
                  <th scope="col" className="py-1 font-medium">After</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                <tr>
                  <th scope="row" className="py-1 font-sans font-normal">Qualify</th>
                  <td>{shown.preview.before.sharePercent}%</td>
                  <td>{shown.preview.sharePercent}%</td>
                </tr>
                <tr>
                  <th scope="row" className="py-1 font-sans font-normal">Average discount</th>
                  <td>{shown.preview.before.averageDiscountPercent}%</td>
                  <td>{shown.preview.averageDiscountPercent}%</td>
                </tr>
                <tr>
                  <th scope="row" className="py-1 font-sans font-normal">Given away per 1,000 sales</th>
                  <td>${Math.round(shown.preview.before.giveawayPer1000Cents / 100).toLocaleString("en-US")}</td>
                  <td>${Math.round(shown.preview.giveawayPer1000Cents / 100).toLocaleString("en-US")}</td>
                </tr>
              </tbody>
            </table>
          ) : null}
          <ul className="mt-2 space-y-1 text-sm">
            {shown.preview.tiers.map((t) => (
              <li key={t.tierId} className="flex items-center justify-between gap-3">
                <span className="min-w-0 break-words">
                  {t.label} ({t.discountPercent}% off)
                </span>
                <span className="shrink-0 font-mono text-xs">
                  {t.count} of {shown.preview!.n}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">Sample: {shown.preview.frame}.</p>
        </>
      ) : shown?.failed ? (
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">The preview is unavailable right now.</p>
      ) : (
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">Running the rule over the sample…</p>
      )}
    </div>
  );
}
