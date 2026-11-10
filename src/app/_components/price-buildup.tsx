"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Chip, type Tone } from "./ui";
import type { ExplainCondition, ExplainRow, Quote } from "./types";
import {
  STAGGER_MS,
  STATUS_TEXT,
  TRUNCATED_NOTICE,
  conditionProgress,
  evidenceLabel,
  revealSchedule,
  runningPriceCents,
  safeHttpUrl,
  sentence,
  sourceBadge,
  splitEvidence,
  usd,
} from "./view-model";

const REDUCED = "(prefers-reduced-motion: reduce)";

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(REDUCED);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/** Number of rows shown so far: all of them at once under reduced motion, else one more every STAGGER_MS. */
function useRevealed(rowCount: number, instant: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (instant) return;
    const { rows, final } = revealSchedule(rowCount);
    const timers = [...rows, final].map((ms, i) => setTimeout(() => setN(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [rowCount, instant]);
  return instant ? rowCount + 1 : n;
}

/** Eases the displayed price down to `target` over one stagger; jumps straight there when `instant`. */
function useCountDown(target: number, instant: boolean): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (instant || current.current === target) return;
    const from = current.current;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / STAGGER_MS);
      current.current = Math.round(from + (target - from) * k);
      setShown(current.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, instant]);
  return instant ? target : shown;
}

const reveal = (on: boolean) => `motion-safe:transition-opacity motion-safe:duration-300 ${on ? "opacity-100" : "opacity-0"}`;

const statusTone: Record<ExplainRow["status"], Tone> = { applied: "ok", superseded: "info", not_met: "warn" };

function Evidence({ urls, context }: { urls: string[]; context: string }) {
  const { shown, rest } = splitEvidence(urls);
  if (shown.length === 0) return null;
  const link = (u: string, i: number) => (
    <a
      key={u}
      href={safeHttpUrl(u) ?? undefined}
      target="_blank"
      rel="noreferrer noopener"
      className="break-all rounded text-blue-700 underline underline-offset-2 dark:text-blue-300"
    >
      {evidenceLabel(u)}
      <span className="sr-only">
        {" "}
        (evidence {i + 1} for {context}, opens in a new tab)
      </span>
    </a>
  );
  return (
    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
      <span className="text-stone-500 dark:text-stone-400">Evidence:</span>
      {shown.map(link)}
      {rest.length > 0 ? (
        <details className="basis-full">
          <summary className="cursor-pointer rounded text-stone-600 dark:text-stone-400">
            {rest.length} more
          </summary>
          <div className="mt-1 flex flex-col gap-1">{rest.map((u, i) => link(u, shown.length + i))}</div>
        </details>
      ) : null}
    </div>
  );
}

function Condition({ c }: { c: ExplainCondition }) {
  const text = sentence(c.text);
  return (
    <li className="py-2">
      <p className="break-words text-sm">{text}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-mono">{conditionProgress(c)}</span>
        <Chip tone={c.passed ? "ok" : "bad"}>{c.passed ? "Passed" : "Not passed"}</Chip>
        {!c.passed && c.missing ? <span className="font-medium">{sentence(c.missing)}</span> : null}
      </p>
      <Evidence urls={c.evidence} context={text} />
    </li>
  );
}

function Row({ row, shown }: { row: ExplainRow; shown: boolean }) {
  const dim = row.status === "superseded";
  return (
    <li
      className={`rounded-lg border p-3 ${reveal(shown)} ${
        dim
          ? "border-dashed border-stone-300 text-stone-500 dark:border-stone-700 dark:text-stone-400"
          : "border-stone-200 dark:border-stone-800"
      } ${row.status === "applied" ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {row.label} <span className="font-mono font-normal">{row.discountPercent}% off</span>
        </h3>
        <Chip tone={statusTone[row.status]}>{STATUS_TEXT[row.status]}</Chip>
      </div>
      <ul className="mt-1 divide-y divide-stone-200 dark:divide-stone-800">
        {row.conditions.map((c, i) => (
          <Condition key={i} c={c} />
        ))}
      </ul>
    </li>
  );
}

/** Price build-up: the list price, each tier in rule order, the running price counting down, the final price. */
export function PriceBuildUp({ quote }: { quote: Quote }) {
  const view = quote.view;
  const rows = view?.rows ?? [];
  const reduced = useReducedMotion();
  const revealed = useRevealed(rows.length, reduced);
  const running = useCountDown(view ? runningPriceCents(view, revealed) : quote.listCents, reduced);
  const badge = sourceBadge(quote);
  const done = revealed > rows.length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {badge ? <Chip tone="info">{badge}</Chip> : null}
        {quote.truncated ? <Chip tone="warn">{TRUNCATED_NOTICE}</Chip> : null}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
        <span className="text-sm text-stone-600 dark:text-stone-400">
          List price <span className="font-mono">{usd(quote.listCents)}</span>
        </span>
        <span aria-hidden="true" className="flex items-baseline gap-2">
          <span className="text-xs text-stone-500 dark:text-stone-400">running price</span>
          <span className="font-mono text-xl font-semibold tabular-nums">{usd(running)}</span>
        </span>
      </div>

      {view && rows.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-3" aria-label="Tiers in rule order">
          {rows.map((row, i) => (
            <Row key={row.tierId} row={row} shown={revealed > i} />
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
          No facts were proven, so no tier was checked and the list price stands.
        </p>
      )}

      <p className={`mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-stone-200 pt-3 dark:border-stone-800 ${reveal(done)}`}>
        <span className="text-sm font-medium">
          You pay
          {quote.discountCents > 0 ? (
            <span className="ml-2 font-normal text-stone-600 dark:text-stone-400">
              (saves <span className="font-mono">{usd(quote.discountCents)}</span>)
            </span>
          ) : null}
        </span>
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-3xl font-semibold tabular-nums">{usd(quote.earnedCents)}</span>
          <span className="text-xs text-stone-500 dark:text-stone-400">price quote</span>
        </span>
      </p>
    </div>
  );
}
