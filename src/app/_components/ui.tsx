import type { ReactNode } from "react";

export type Tone = "ok" | "bad" | "warn" | "info";

const toneClass: Record<Tone, string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100",
  bad: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100",
  info: "border-stone-300 bg-stone-100 text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200",
};

const iconPath: Record<Tone, string> = {
  ok: "M4 10.5l4 4 8-9", // check
  bad: "M5 5l10 10M15 5L5 15", // cross
  warn: "M10 6v5M10 14v.5", // exclamation
  info: "M10 9v5M10 6v.5", // i
};

function Icon({ tone }: { tone: Tone }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="mt-0.5 h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {tone === "info" || tone === "warn" ? <circle cx="10" cy="10" r="8" /> : null}
      <path d={iconPath[tone]} />
    </svg>
  );
}

/** Status message: icon plus text, never colour alone. */
export function Notice({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${toneClass[tone]}`}
    >
      <Icon tone={tone} />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass[tone]}`}
    >
      <Icon tone={tone} />
      {children}
    </span>
  );
}

export const card =
  "rounded-xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900/60";

export const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300";

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
