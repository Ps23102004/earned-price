"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SAMPLES = [
  { name: "qualifies", label: "Strong contributor sample" },
  { name: "nearly", label: "Nearly qualifies sample" },
  { name: "loophole", label: "Loophole sample" },
] as const;

const btn =
  "inline-flex min-h-11 items-center rounded-lg border border-stone-300 px-3 text-sm font-medium hover:bg-stone-100 disabled:opacity-60 dark:border-stone-700 dark:hover:bg-stone-800";

// Buy first, prove later: the amount is computed by the server from the proven facts; this sends no amount.
export function ClaimPanel({ orderId, login }: { orderId: string; login?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function claim(sample?: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample ? { sample } : {}),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setMsg(json.message ?? json.error ?? `Claim failed (HTTP ${res.status}).`);
      router.refresh();
    } catch {
      setMsg("Claim failed: network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="claim-heading" className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900/60">
      <h2 id="claim-heading" className="text-sm font-semibold">
        Prove your facts for a refund
      </h2>
      <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
        You paid full price. Prove public GitHub facts and the code refunds the difference between what you paid and what the rules say you earned.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {login ? (
          <button type="button" className={btn} disabled={busy} onClick={() => claim()}>
            {busy ? "Claiming…" : `Claim refund as ${login}`}
          </button>
        ) : (
          <a className={btn} href={`/api/auth/github?returnTo=${encodeURIComponent(`/receipt/${orderId}`)}`}>
            Sign in with GitHub
          </a>
        )}
        {SAMPLES.map((s) => (
          <button key={s.name} type="button" className={btn} disabled={busy} onClick={() => claim(s.name)}>
            {s.label}
          </button>
        ))}
      </div>
      {msg ? (
        <p role="status" className="mt-2 text-sm">
          {msg}
        </p>
      ) : null}
    </section>
  );
}
