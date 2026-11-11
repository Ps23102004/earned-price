"use client";

import { useSyncExternalStore } from "react";
import { CopyButton } from "../_components/copy-button";
import { card } from "../_components/ui";

export function AgentCommands({ fallbackOrigin }: { fallbackOrigin: string }) {
  // The site's own address: empty on the server, the real origin in the browser.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const url = `${origin || fallbackOrigin}/api/mcp`;
  const add = `claude mcp add --transport http earned-price ${url}`;
  const curl = `curl -s ${url} -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"preview_price","arguments":{"sample":"qualifies"}}}'`;
  return (
    <section aria-labelledby="try-heading" className={card}>
      <h2 id="try-heading" className="text-sm font-semibold">
        Try it
      </h2>
      {[
        { label: "Add it to Claude Code", value: add },
        { label: "Or call it directly", value: curl },
      ].map((c) => (
        <div key={c.label} className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium">{c.label}</p>
            <CopyButton value={c.value} label={c.label.toLowerCase()} />
          </div>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-stone-100 p-3 text-xs dark:bg-stone-950">{c.value}</pre>
        </div>
      ))}
    </section>
  );
}
