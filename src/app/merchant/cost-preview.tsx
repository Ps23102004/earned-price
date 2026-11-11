"use client";

import { useEffect, useState } from "react";
import { Chip } from "../_components/ui";

type Preview = {
  n: number;
  qualifying: number;
  sharePercent: number;
  averageDiscountPercent: number;
  tiers: { tierId: string; label: string; discountPercent: number; count: number }[];
  summary: string;
  recordedAt: string;
  frame: string;
};

// What would this rule cost? Code runs the rule over a recorded sample; no model and no live GitHub call.
export function CostPreview({ ruleId }: { ruleId: string }) {
  const [state, setState] = useState<{ ruleId: string; preview?: Preview; failed?: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/merchant/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruleId }) })
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
  }, [ruleId]);

  const shown = state?.ruleId === ruleId ? state : null;
  return (
    <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Cost preview</h3>
        <Chip tone="info">code-computed · recorded sample</Chip>
      </div>
      {shown?.preview ? (
        <>
          <p className="mt-2 text-sm">{shown.preview.summary}</p>
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
