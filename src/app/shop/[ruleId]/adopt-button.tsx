"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "../../_components/ui";

export function AdoptButton({ ruleId }: { ruleId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/merchant/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruleId }) });
      if (!res.ok) throw new Error(String(res.status));
      router.push("/");
    } catch {
      setError("Could not start this checkout. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" className={buttonClass} onClick={start} disabled={busy}>
        {busy ? "Starting…" : "Start checkout under this rule"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
