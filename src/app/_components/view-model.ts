// Pure view helpers for the price build-up and shop flow. No React, no clock, no I/O.

import type { ExplainCondition, ExplainRow, ExplainView, Quote } from "./types";

/** Delay between one price-build-up row appearing and the next. */
export const STAGGER_MS = 350;

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const num = (n: number) => n.toLocaleString("en-US");

export const TRUNCATED_NOTICE = "Only your 300 most recent merged PRs were checked";

/** First letter upper-cased: the read-back phrases start in lower case ("the account has ..."). */
export const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "Nov 12, 2026" in UTC, so server and browser render the same text. Empty string for an unparsable value. */
export function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

/** The label under each sample card. The date is left out when it is not known. */
export function sampleProvenance(recordedAt?: string): string {
  const base = "Recorded snapshot of real public data, anonymised";
  const d = formatDate(recordedAt);
  return d ? `${base}, ${d}` : base;
}

export function sourceBadge(q: Pick<Quote, "source" | "recordedAt">): string | null {
  if (q.source === "live") return "Live from GitHub (just now)";
  if (q.source === "sample") {
    const d = formatDate(q.recordedAt);
    return d ? `Recorded snapshot, ${d}` : "Recorded snapshot";
  }
  return null;
}

export const conditionProgress = (c: Pick<ExplainCondition, "actual" | "threshold">) =>
  `${num(c.actual)} / ${num(c.threshold)}`;

export const STATUS_TEXT: Record<ExplainRow["status"], string> = {
  applied: "Applied",
  superseded: "Passes, but a better tier applies",
  not_met: "Not met",
};

/** Row i appears at `i * STAGGER_MS`; the final "You pay" line one stagger after the last row. */
export function revealSchedule(rowCount: number): { rows: number[]; final: number } {
  return { rows: Array.from({ length: rowCount }, (_, i) => i * STAGGER_MS), final: rowCount * STAGGER_MS };
}

/** Running price once `revealed` rows are on screen: the list price until the applied row appears, then the earned price. */
export function runningPriceCents(view: ExplainView, revealed: number): number {
  const at = view.rows.findIndex((r) => r.status === "applied");
  return at >= 0 && revealed > at ? view.earnedCents : view.listCents;
}

/** Only http(s) URLs become links; anything else (javascript:, data:, junk) is dropped. */
export function safeHttpUrl(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : null;
  } catch {
    return null;
  }
}

/** Short link text: "owner/repo#123" for a pull request, otherwise the path. */
export function evidenceLabel(u: string): string {
  const safe = safeHttpUrl(u);
  if (!safe) return u;
  const p = new URL(safe);
  const path = p.pathname.replace(/^\/+|\/+$/g, "").replace(/\/pull\/(\d+)$/, "#$1");
  return path || p.host;
}

/** Show a few links inline and tuck the rest behind a disclosure. */
export function splitEvidence(urls: string[], inline = 3): { shown: string[]; rest: string[] } {
  const ok = urls.filter((u) => safeHttpUrl(u) !== null);
  return { shown: ok.slice(0, inline), rest: ok.slice(inline) };
}

/** GitHub avatars only; anything else renders as no avatar. */
export function safeAvatarUrl(u: string | undefined): string | null {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === "https:" && p.hostname === "avatars.githubusercontent.com" ? p.href : null;
  } catch {
    return null;
  }
}
