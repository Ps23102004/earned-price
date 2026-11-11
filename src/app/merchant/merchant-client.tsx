"use client";

import { useEffect, useState } from "react";
import { BRIEF_SENTENCE, INJECTION_SENTENCE, MORE_PICKS, UNCHECKABLE_SENTENCE } from "@/ai/quick-picks";
import { Chip, Notice, buttonClass, card } from "../_components/ui";
import { CostPreview } from "./cost-preview";
import { CopyButton } from "../_components/copy-button";
import { RuleBuilder } from "./rule-builder";

type Busy = null | "build" | "compile" | "hunt" | "tighten" | "publish" | "unpublish";

type Compiled = { status: "compiled"; ruleId: string; rule: unknown; readback: string; source: "live" | "cached"; cachedAt?: string };
type Refused = { status: "refused" | "invalid"; reasons: string[]; cachedAt?: string };
type Unavailable = { status: "unavailable"; reason: string };
type CompileResult = Compiled | Refused | Unavailable;

type Strategy = { spiritCheck: string; title: string; why: string; tierId: string };
type Example = { label: string; facts: Record<string, string | number | boolean> };
type Finding = {
  strategy?: Strategy;
  examples: Example[];
  readback: string;
  diff: string[];
  accepted: boolean;
  reasons: string[];
};
type Hunt = { status: "ok"; ruleId: string; source: "live" | "cached"; computedAt: string; strategies: Strategy[]; findings: Finding[] };
type HuntResult = Hunt | Unavailable;

type Current = { ruleId: string; rule: unknown; readback: string; source?: string; diff?: string[]; previousRuleId?: string };

const day = (iso?: string) => {
  const d = iso ? new Date(iso) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
};

// Plain-English names for the anonymised facts shown on a loophole example (unknown keys are spelled out from camelCase).
const FACT_LABEL: Record<string, string> = {
  accountAgeAtMergeDays: "Account age when merged (days)",
  linesChanged: "Lines changed",
  repoStars: "Repository stars (approx.)",
  ownerIsAuthor: "Author owns the repository",
  isFork: "Repository is a fork",
};
const factLabel = (k: string) => FACT_LABEL[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const factValue = (v: string | number | boolean) => (typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

async function call(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export function MerchantClient() {
  const [sentence, setSentence] = useState(BRIEF_SENTENCE);
  const [busy, setBusy] = useState<Busy>(null);
  const [elapsed, setElapsed] = useState(0);
  const [compile, setCompile] = useState<CompileResult | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [hunt, setHunt] = useState<HuntResult | null>(null);
  const [published, setPublished] = useState<{ ruleId: string; readback: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/merchant/active", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { published: { ruleId: string; readback: string } | null }) => {
        if (alive) setPublished(j.published);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  function begin(kind: Busy) {
    setElapsed(0);
    setBusy(kind);
    setError(null);
  }

  async function onCompile() {
    begin("compile");
    try {
      const { ok, json } = await call("/api/merchant/compile", { sentence });
      if (!ok || typeof json.status !== "string") {
        setError(String(json.error ?? "Compile failed. Try again."));
        setCompile(null);
        setCurrent(null);
        setHunt(null);
        return;
      }
      setCompile(json as CompileResult);
      if (json.status === "compiled") {
        setCurrent({ ruleId: json.ruleId, rule: json.rule, readback: json.readback, source: json.source === "cached" ? `Recorded result · ${day(json.cachedAt)}` : "Live model" });
        setHunt(null);
      } else {
        setCurrent(null);
        setHunt(null);
      }
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onBuild(spec: unknown) {
    begin("build");
    try {
      const { ok, json } = await call("/api/merchant/build", spec);
      if (!ok || typeof json.status !== "string") {
        setError(String(json.error ?? "Could not build the rule. Check the values."));
        return;
      }
      setCompile(json as CompileResult);
      setHunt(null);
      if (json.status === "compiled") setCurrent({ ruleId: json.ruleId, rule: json.rule, readback: json.readback, source: "built by hand" });
      else setCurrent(null);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onHunt() {
    if (!current) return;
    begin("hunt");
    try {
      const { json } = await call("/api/merchant/hunt", { ruleId: current.ruleId });
      setHunt(json as HuntResult);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onApply(f: Finding) {
    if (!current || !f.strategy) return;
    begin("tighten");
    try {
      const { ok, json } = await call("/api/merchant/tighten", {
        ruleId: current.ruleId,
        tierId: f.strategy.tierId,
        spiritCheck: f.strategy.spiritCheck,
      });
      if (!ok) {
        setError(String(json.error ?? "Tightening refused.") + (json.reasons ? ` ${(json.reasons as string[]).join("; ")}` : ""));
        return;
      }
      setCurrent({ ruleId: json.ruleId, rule: json.rule, readback: json.readback, source: "tightened", diff: json.diff, previousRuleId: current.ruleId });
      setHunt(null);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onPublish() {
    if (!current) return;
    begin("publish");
    try {
      const { ok, json } = await call("/api/merchant/publish", { ruleId: current.ruleId });
      if (!ok) setError(String(json.error ?? "Publish failed."));
      else setPublished({ ruleId: current.ruleId, readback: current.readback });
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onRevert() {
    begin("unpublish");
    try {
      const { ok, json } = await call("/api/merchant/unpublish", {});
      if (!ok) setError(String(json.error ?? "Revert failed."));
      else setPublished(null);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const huntOk = hunt?.status === "ok" ? hunt : null;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="sentence-heading" className={card}>
        <h2 id="sentence-heading" className="text-base font-semibold">
          1. Your sentence
        </h2>
        <label htmlFor="sentence" className="mt-3 block text-sm text-stone-700 dark:text-stone-300">
          Describe the discount rules in plain English
        </label>
        <textarea
          id="sentence"
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          maxLength={600}
          rows={4}
          className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-3 text-sm dark:border-stone-700 dark:bg-stone-950"
        />
        <div className="mt-1 flex justify-between text-xs text-stone-600 dark:text-stone-400">
          <span>{sentence.length} / 600 characters</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Quick picks">
          {[
            { text: BRIEF_SENTENCE, name: "Brief example" },
            { text: UNCHECKABLE_SENTENCE, name: "Uncheckable" },
            { text: INJECTION_SENTENCE, name: "Injection attempt" },
            ...MORE_PICKS,
          ].map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => setSentence(p.text)}
              className="min-h-9 rounded-full border border-stone-300 px-3 text-xs hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={buttonClass} onClick={onCompile} disabled={busy !== null || sentence.trim().length === 0}>
            Compile
          </button>
          {busy === "compile" ? (
            <span role="status" className="text-sm text-stone-700 dark:text-stone-300">
              Compiling with the local model… {elapsed}s. This can take up to two minutes.
            </span>
          ) : null}
        </div>
        <RuleBuilder busy={busy !== null} onBuild={onBuild} />
      </section>

      {error ? <Notice tone="bad">{error}</Notice> : null}

      <section aria-labelledby="rule-heading" className={card}>
        <h2 id="rule-heading" className="text-base font-semibold">
          2. Your rule
        </h2>
        {compile === null ? (
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">Nothing compiled yet.</p>
        ) : compile.status === "compiled" ? (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Chip tone="ok">{current?.source === "built by hand" ? "Built by hand · code validated" : "AI proposed · code validated"}</Chip>
              <Chip tone="info">{current?.source ?? compile.source}</Chip>
            </div>
            {current?.source?.startsWith("Recorded") ? (
              <p className="text-xs text-stone-600 dark:text-stone-400">This is a recorded result for an example sentence. Type your own sentence for a live compile.</p>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="min-w-0">
                <h3 className="text-sm font-medium">Rule (JSON)</h3>
                <pre className="mt-1 max-h-96 overflow-auto rounded-lg bg-stone-100 p-3 font-mono text-xs dark:bg-stone-950">
                  {JSON.stringify(current?.rule ?? compile.rule, null, 2)}
                </pre>
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-medium">Read-back (generated by code)</h3>
                <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-sm dark:bg-stone-950">
                  {current?.readback ?? compile.readback}
                </pre>
              </div>
            </div>
            <CostPreview ruleId={current?.ruleId ?? compile.ruleId} compareRuleId={current?.previousRuleId} />
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <Notice tone={compile.status === "unavailable" ? "info" : "bad"}>
              {compile.status === "unavailable" ? (
                <>Unavailable: {compile.reason}</>
              ) : (
                <>
                  {compile.status === "refused" ? "Refused" : "Invalid"}: {(compile.reasons ?? []).join("; ")}. Nothing was published.
                  {compile.cachedAt ? ` (recorded refusal, ${day(compile.cachedAt)})` : ""}
                </>
              )}
            </Notice>
          </div>
        )}
      </section>

      <section aria-labelledby="hunt-heading" className={card}>
        <h2 id="hunt-heading" className="text-base font-semibold">
          3. Loophole hunt
        </h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          Every example below was re-checked by code against the current rule.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={buttonClass} onClick={onHunt} disabled={!current || busy !== null}>
            Hunt for loopholes
          </button>
          {busy === "hunt" ? (
            <span role="status" className="text-sm text-stone-700 dark:text-stone-300">
              Hunting… {elapsed}s
            </span>
          ) : null}
        </div>

        {hunt && hunt.status === "unavailable" ? (
          <div className="mt-3">
            <Notice tone="info">Unavailable: {hunt.reason}</Notice>
          </div>
        ) : null}

        {huntOk ? (
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Chip tone="info">
                {huntOk.source === "live" ? "Live hunt" : "Recorded hunt"} · {day(huntOk.computedAt)}
              </Chip>
              <Chip tone="info">{huntOk.strategies.length} strategies</Chip>
            </div>
            {huntOk.strategies.length > 0 ? (
              <ul className="flex flex-col gap-2 text-sm">
                {huntOk.strategies.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.title}.</span> {s.why}
                  </li>
                ))}
              </ul>
            ) : null}
            {huntOk.findings.length === 0 ? (
              <p className="text-sm text-stone-600 dark:text-stone-400">No loophole found for this rule.</p>
            ) : (
              huntOk.findings.map((f, i) => (
                <article key={i} className="rounded-lg border border-stone-200 p-4 dark:border-stone-700">
                  <h3 className="text-sm font-semibold">{f.strategy?.title ?? "Finding"}</h3>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {f.examples.map((ex) => (
                      <li key={ex.label} className="rounded-md bg-stone-100 p-3 text-xs dark:bg-stone-950">
                        <div className="font-medium">{ex.label}</div>
                        <dl className="mt-1 grid grid-cols-2 gap-x-2">
                          {Object.entries(ex.facts).map(([k, v]) => (
                            <div key={k} className="contents">
                              <dt className="text-stone-600 dark:text-stone-400">{factLabel(k)}</dt>
                              <dd>{factValue(v)}</dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                  {f.strategy?.spiritCheck === "own_repo" ? (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      Limit: this only catches repositories owned by the author&apos;s own account. A repository owned by an organisation the author controls cannot be seen from public data.
                    </p>
                  ) : null}
                  <h4 className="mt-3 text-xs font-medium">Proposed tightening (read-back diff)</h4>
                  <ul className="mt-1 list-disc pl-5 text-sm">
                    {f.diff.map((line, j) => (
                      <li key={j}>{line}</li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => onApply(f)}
                      disabled={!f.accepted || busy !== null}
                    >
                      Apply tightening
                    </button>
                    {!f.accepted ? (
                      <span className="text-xs text-stone-600 dark:text-stone-400">Not applicable: {f.reasons.join("; ")}</span>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="publish-heading" className={card}>
        <h2 id="publish-heading" className="text-base font-semibold">
          4. Publish
        </h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          Publishing prices this browser&apos;s shop under the rule and gives you a checkout link. Anyone who opens the link is priced under it too; everyone else keeps the default rule.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={buttonClass} onClick={onPublish} disabled={!current || busy !== null}>
            Publish and get a checkout link
          </button>
          <button
            type="button"
            onClick={onRevert}
            disabled={!published || busy !== null}
            className="min-h-11 rounded-lg border border-stone-300 px-4 text-sm disabled:opacity-60 dark:border-stone-700"
          >
            Revert to default
          </button>
        </div>
        <div className="mt-4">
          {published ? (
            <>
              <Chip tone="ok">Published in this browser</Chip>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-sm dark:bg-stone-950">{published.readback}</pre>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">Checkout link</span>
                <code className="min-w-0 break-all rounded bg-stone-100 px-2 py-1 text-xs dark:bg-stone-950">{`${typeof window === "undefined" ? "" : window.location.origin}/shop/${published.ruleId}`}</code>
                <CopyButton value={`${typeof window === "undefined" ? "" : window.location.origin}/shop/${published.ruleId}`} label="checkout link" />
              </div>
              <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">Anyone who opens this link is priced under this rule. Send it to a second browser to see it.</p>
            </>
          ) : (
            <p className="text-sm text-stone-600 dark:text-stone-400">The shop uses the default rule.</p>
          )}
        </div>
      </section>
    </div>
  );
}
