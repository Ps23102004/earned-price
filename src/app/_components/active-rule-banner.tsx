"use client";

import { useEffect, useState } from "react";
import { CopyButton } from "./copy-button";

type Active = { ruleId: string; readback: string };

// Shown above the shop when this browser is pricing under a merchant's published rule (its own, or one opened from a link).
export function ActiveRuleBanner() {
  const [active, setActive] = useState<Active | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/merchant/active")
      .then((r) => r.json())
      .then((j: { published: Active | null }) => {
        if (alive) {
          setActive(j.published);
          setOrigin(window.location.origin);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function useDefault() {
    await fetch("/api/merchant/unpublish", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    window.location.reload();
  }

  if (!active) return null;
  return (
    <section aria-label="Pricing rule in use" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      <p className="font-medium">Pricing under a merchant&apos;s published rule</p>
      <p className="mt-1 whitespace-pre-line break-words text-xs text-stone-700 dark:text-stone-300">{active.readback}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={useDefault}
          className="min-h-9 rounded-md border border-stone-300 px-3 text-xs font-medium hover:bg-white dark:border-stone-700 dark:hover:bg-stone-900"
        >
          Use the default rule instead
        </button>
        <CopyButton value={`${origin}/shop/${active.ruleId}`} label="checkout link" />
        <span className="text-xs text-stone-600 dark:text-stone-400">checkout link</span>
      </div>
    </section>
  );
}
