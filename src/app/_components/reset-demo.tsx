"use client";

import { useState } from "react";

// Judge-mode only: releases this browser's redemption (its GitHub account and/or current sample profile)
// so the discounted purchase can be repeated. Orders and refunds are never changed.
export function ResetDemo() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reset() {
    setBusy(true);
    try {
      const res = await fetch("/api/judge/reset", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { released?: number; error?: string };
      if (!res.ok) setMsg(json.error ?? `Reset failed (HTTP ${res.status}).`);
      else setMsg(json.released ? "Redemption released. You can buy at the earned price again." : "Nothing to release for this profile.");
    } catch {
      setMsg("Reset failed: network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-stone-200 pt-3 dark:border-stone-800">
      <p className="text-xs text-stone-600 dark:text-stone-400">
        Each GitHub account (or sample profile in this browser) can redeem its discount once.
      </p>
      <button
        type="button"
        onClick={reset}
        disabled={busy}
        className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-stone-300 px-3 text-sm font-medium hover:bg-stone-100 disabled:opacity-60 dark:border-stone-700 dark:hover:bg-stone-800"
      >
        {busy ? "Releasing…" : "Demo only: release this account's redemption"}
      </button>
      {msg ? (
        <p role="status" className="mt-2 text-sm">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
