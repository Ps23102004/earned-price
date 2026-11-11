// Server-renderable: the published rule as plain English and as the JSON the code evaluates.
export function TheRule({ readback, json }: { readback: string; json: string }) {
  return (
    <details className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900/60">
      <summary className="cursor-pointer rounded text-sm font-semibold">The default rule</summary>
      <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
        This is the default rule, in plain English and as data. If you published a rule on the merchant page, your price is computed from that one instead.
      </p>
      <p className="mt-2 whitespace-pre-line break-words text-sm">{readback}</p>
      <pre
        tabIndex={0}
        aria-label="The rule as JSON"
        className="mt-3 max-h-80 overflow-auto rounded-lg bg-stone-100 p-3 font-mono text-xs dark:bg-stone-950"
      >
        {json}
      </pre>
    </details>
  );
}
