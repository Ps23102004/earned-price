// Price quotes (docs/ARCHITECTURE.md section 3.5, Quote): facts -> evaluate -> price -> one `quoted` order row.
// The client never sends a price; the rule is always the shop's published default.

import { randomUUID } from "node:crypto";
import { fetchGithubFacts } from "../facts/github";
import { loadSample } from "../facts/samples";
import type { SampleName } from "../facts/samples";
import { canonicalJson, snapshotHash } from "../facts/snapshot";
import type { GithubSnapshot } from "../facts/types";
import { DEFAULT_RULE } from "../rules/presets";
import { evaluate } from "../rules/evaluate";
import { explain } from "../rules/explain";
import { price } from "../rules/price";
import { allow } from "../ratelimit";
import { query } from "./db";
import { createGuestQuote } from "./orders";
import { ensureRule } from "./rules";

const LIST_CENTS = 4900;
type Result = { status: number; body: unknown };
type Who = { sid: string; ip: string; github?: { id: number; login: string }; sample?: SampleName };

export async function createQuote(who: Who): Promise<Result> {
  if (!who.sample && !who.github) {
    const r = await createGuestQuote(who.sid);
    const orderId = (r.body as { orderId: string }).orderId;
    const evaluatedAt = new Date().toISOString();
    const view = { rows: [], listCents: LIST_CENTS, earnedCents: LIST_CENTS, discountCents: 0, evaluatedAt };
    return { status: 200, body: { orderId, listCents: LIST_CENTS, earnedCents: LIST_CENTS, discountCents: 0, view, source: "guest", truncated: false } };
  }

  let snapshot: GithubSnapshot;
  let buyerSource: string; // what buyer_key becomes if the quote earns a discount
  if (who.sample) {
    snapshot = loadSample(who.sample);
    buyerSource = `sample:${who.sample}:${who.sid}`;
  } else {
    const github = who.github!;
    if (!allow(`live:${who.ip}`, 20, 3_600_000)) {
      return { status: 429, body: { error: "too many live lookups, try again later or use a sample profile" } };
    }
    try {
      const token = process.env.GITHUB_SERVER_TOKEN;
      if (!token) throw new Error("GITHUB_SERVER_TOKEN is not set");
      const facts = await fetchGithubFacts(github.login, DEFAULT_RULE, { token });
      if (facts.databaseId !== github.id) return { status: 409, body: { error: "account changed" } };
      snapshot = facts.snapshot;
    } catch (err) {
      console.error("github facts failed:", err instanceof Error ? err.message : err);
      return { status: 502, body: { error: "GitHub is unavailable; try again or use a sample profile" } };
    }
    buyerSource = `github:${github.id}`;
  }

  const result = evaluate(DEFAULT_RULE, snapshot, snapshot.recordedAt ? new Date(snapshot.recordedAt) : undefined);
  const p = price(DEFAULT_RULE, result, LIST_CENTS);
  const view = explain(DEFAULT_RULE, result, p);
  const rule = await ensureRule("default");
  const json = canonicalJson(snapshot);
  const hash = snapshotHash(snapshot);
  const buyerKey = p.discountCents > 0 ? buyerSource : null; // a zero-discount purchase is a guest order

  // Reuse this session's open quote only if it was made from the very same facts, rule and buyer.
  const open = await query<{ id: string }>(
    `select id from orders where session_id = $1 and state = 'quoted' and expires_at > now() + interval '5 minutes'
       and snapshot_hash = $2 and rule_id = $3 and rule_version = $4 and buyer_key is not distinct from $5
     order by created_at desc limit 1`,
    [who.sid, hash, rule.id, rule.version, buyerKey],
  );
  let orderId = open.rows[0]?.id;
  if (!orderId) {
    orderId = randomUUID();
    await query(
      `insert into orders (id, state, rule_id, rule_version, session_id, buyer_key, snapshot_json, snapshot_hash,
         list_cents, earned_cents, discount_cents, expires_at)
       values ($1, 'quoted', $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + interval '15 minutes')`,
      [orderId, rule.id, rule.version, who.sid, buyerKey, json, hash, LIST_CENTS, p.earnedCents, p.discountCents],
    );
  }
  return {
    status: 200,
    body: {
      orderId,
      listCents: LIST_CENTS,
      earnedCents: p.earnedCents,
      discountCents: p.discountCents,
      view,
      source: who.sample ? "sample" : "live",
      ...(snapshot.label ? { label: snapshot.label } : {}),
      ...(snapshot.recordedAt ? { recordedAt: snapshot.recordedAt } : {}),
      truncated: snapshot.truncated,
    },
  };
}
