// What the /api/merchant/* routes do, kept out of the route files. AI proposes, code decides: every rule that
// reaches a row or a session is a validated Rule, and tightenings are recomputed here, never read from the client.

import { compileSentence } from "../ai/compile";
import { findHunt, huntLoopholes } from "../ai/hunt";
import { SPIRIT_CHECKS, acceptTightening, tighteningFor } from "../ai/hunt-plan";
import type { SpiritCheck } from "../ai/hunt-plan";
import { allow } from "../ratelimit";
import { SAMPLE_ACCOUNTS } from "../facts/sample-accounts";
import { costPreview } from "../rules/cost-preview";
import { readback } from "../rules/readback";
import type { Rule } from "../rules/types";
import type { ApiResult, Session } from "../session";
import { loadRuleRow, saveRule } from "./rules";

const HOUR = 3_600_000;

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > 4_000) return null;
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const bad = (error = "invalid request"): ApiResult => ({ status: 400, body: { error } });
const notFound = (): ApiResult => ({ status: 404, body: { error: "rule not found" } });

export function readbackDiff(before: Rule, after: Rule): string[] {
  const old = new Set(readback(before).split("\n"));
  return readback(after).split("\n").filter((l) => !old.has(l));
}

export async function compileAction(sentence: unknown, ip: string): Promise<ApiResult> {
  if (typeof sentence !== "string") return bad();
  let limited = false;
  const r = await compileSentence(sentence, {
    allowLive: () => {
      const ok = allow(`compile:${ip}`, 10, HOUR) && allow("compile:global", 200, 24 * HOUR);
      limited = !ok;
      return ok;
    },
  });
  if (r.status === "unavailable") return { status: limited ? 429 : 200, body: { status: "unavailable", reason: limited ? "too many live compiles, try again later" : r.reason } };
  if (r.status !== "compiled") return { status: 200, body: r };
  const row = await saveRule(sentence.trim(), r.rule);
  return {
    status: 200,
    body: { status: "compiled", ruleId: row.id, rule: r.rule, readback: r.readback, source: r.source, ...(r.cachedAt ? { cachedAt: r.cachedAt } : {}) },
  };
}

export async function huntAction(ruleId: unknown, ip: string): Promise<ApiResult> {
  const row = await loadRuleRow(ruleId);
  if (!row) return notFound();
  const out = await huntLoopholes(row.rule, { ip });
  if (out.status === "rate_limited") return { status: 429, body: { status: "unavailable", reason: "too many live hunts, try again later" } };
  if (out.status === "unavailable") return { status: 200, body: out };
  return {
    status: 200,
    body: {
      status: "ok",
      ruleId: row.id,
      source: out.source,
      computedAt: out.computedAt,
      strategies: out.strategies,
      findings: out.findings.map((f) => ({
        ...f,
        readback: readback(f.tightening),
        diff: readbackDiff(row.rule, f.tightening),
      })),
    },
  };
}

export async function tightenAction(ruleId: unknown, tierId: unknown, spiritCheck: unknown): Promise<ApiResult> {
  if (typeof tierId !== "string" || !(SPIRIT_CHECKS as readonly unknown[]).includes(spiritCheck)) return bad();
  const check = spiritCheck as SpiritCheck;
  const row = await loadRuleRow(ruleId);
  if (!row) return notFound();
  const finding = (await findHunt(row.rule))?.findings.find((f) => f.strategy.tierId === tierId && f.strategy.spiritCheck === check);
  if (!finding) return { status: 409, body: { error: "no verified loophole for that tier and check; run the hunt first" } };

  const rule = tighteningFor(check, row.rule, tierId); // recomputed here: a client never supplies a rule
  const verdict = acceptTightening(row.rule, rule, finding.examples.map((e) => e.snapshot), tierId, (s) => new Date(s.recordedAt ?? ""));
  if (!verdict.ok) return { status: 409, body: { error: "the tightening was not accepted", reasons: verdict.reasons } };
  const saved = await saveRule(`tightened:${row.id}:${tierId}:${check}`, rule);
  return { status: 200, body: { ruleId: saved.id, rule, readback: readback(rule), diff: readbackDiff(row.rule, rule) } };
}

export async function publishAction(session: Session, ruleId: unknown): Promise<ApiResult> {
  const row = await loadRuleRow(ruleId); // validates the stored rule again
  if (!row) return notFound();
  session.activeRuleId = row.id;
  await session.save();
  return { status: 200, body: { ok: true } };
}

export async function unpublishAction(session: Session): Promise<ApiResult> {
  delete session.activeRuleId;
  await session.save();
  return { status: 200, body: { ok: true } };
}

/** For the merchant page: this browser's published rule, if any and still valid. */
export async function activeRuleView(session: Session): Promise<{ ruleId: string; rule: Rule; readback: string } | null> {
  const row = session.activeRuleId ? await loadRuleRow(session.activeRuleId) : undefined;
  return row ? { ruleId: row.id, rule: row.rule, readback: readback(row.rule) } : null;
}

/** Rough cost of a rule over the recorded sample of accounts. Deterministic; no model, no GitHub call, no database write. */
export async function previewAction(ruleId: unknown): Promise<ApiResult> {
  const row = await loadRuleRow(ruleId);
  if (!row) return notFound();
  const { recordedAt, frame, accounts } = SAMPLE_ACCOUNTS;
  return { status: 200, body: { ...costPreview(row.rule, accounts, recordedAt), recordedAt, frame } };
}
