// Proof P2: a partial refund sent twice with the same PayPal-Request-Id yields one refund; read back from PayPal.
// Run: pnpm tsx --env-file=.env scripts/proofs/p2-refund-twice.mts <capture-id> [cents]
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { paypal } from "../../src/paypal/client";
import { toPayPalValue } from "../../src/paypal/money";

const captureId = process.argv[2];
const cents = Number(process.argv[3] ?? 500);
if (!captureId) throw new Error("usage: p2-refund-twice.mts <capture-id> [cents]");
const key = randomUUID().replaceAll("-", ""); // 32 chars
const claimHash = "1".repeat(64);
const body = { amount: { currency_code: "USD", value: toPayPalValue(cents) }, custom_id: claimHash.slice(0, 127) };

const r1 = await paypal("POST", `/v2/payments/captures/${captureId}/refund`, { requestId: key, representation: true, body });
const r2 = await paypal("POST", `/v2/payments/captures/${captureId}/refund`, { requestId: key, representation: true, body });
const r3 = await paypal("POST", `/v2/payments/captures/${captureId}/refund`, {
  requestId: key, representation: true, body: { amount: { currency_code: "USD", value: "20.00" } },
});
if (!r1.ok) {
  console.error("FAIL first refund", r1.status, r1.debugId, JSON.stringify(r1.json).slice(0, 500));
  process.exit(1);
}
const get = await paypal("GET", `/v2/payments/refunds/${r1.json.id}`);
const capGet = await paypal("GET", `/v2/payments/captures/${captureId}`);
const orderId = capGet.json?.supplementary_data?.related_ids?.order_id;
const order = orderId ? await paypal("GET", `/v2/checkout/orders/${orderId}`) : undefined;
const refundsOnOrder = order?.json?.purchase_units?.[0]?.payments?.refunds ?? [];

const read = {
  first: { http: r1.status, id: r1.json.id, status: r1.json.status, amount: r1.json.amount?.value },
  second: { http: r2.status, id: r2.json?.id, status: r2.json?.status },
  thirdDifferentBody: { http: r3.status, id: r3.json?.id, amount: r3.json?.amount?.value },
  get: { status: get.json?.status, amount: get.json?.amount?.value, customId: get.json?.custom_id, up: get.json?.links?.find((l: { rel: string }) => l.rel === "up")?.href },
  captureStatusAfter: capGet.json?.status,
  refundsOnOrder: refundsOnOrder.map((r: { id: string; amount: { value: string }; custom_id?: string }) => ({ id: r.id, amount: r.amount?.value, customId: r.custom_id })),
};
const checks = {
  "same key twice -> same refund id": read.second.id === read.first.id,
  "same key, different body -> still the original refund": read.thirdDifferentBody.id === read.first.id,
  "GET refund amount == requested": read.get.amount === toPayPalValue(cents),
  "GET refund custom_id == claim hash": read.get.customId === body.custom_id,
  "refund links up to the capture": Boolean(read.get.up?.endsWith(`/captures/${captureId}`)),
  "exactly one refund on the order": refundsOnOrder.length === 1,
  "GET order payments.refunds[] carries custom_id": refundsOnOrder[0]?.custom_id === body.custom_id,
};
console.log(JSON.stringify(read, null, 2));
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"}  ${k}`);
const pass = Object.values(checks).every(Boolean);
appendFileSync("docs/EVIDENCE.md", `| ${new Date().toISOString().slice(0, 16)}Z | P2 idempotent partial refund | POST /v2/payments/captures/{id}/refund ×3 same PayPal-Request-Id (3rd with a different amount) → GET refund → GET capture → GET order | capture ${captureId}; refund ${read.first.id}; order ${orderId} | requested ${toPayPalValue(cents)}; HTTP ${read.first.http}/${read.second.http}/${read.thirdDifferentBody.http}; refund ids ${read.first.id}/${read.second.id}/${read.thirdDifferentBody.id}; GET refund ${read.get.status} ${read.get.amount}; capture now ${read.captureStatusAfter}; refunds on order ${refundsOnOrder.length} | ${pass ? "PASS" : "FAIL: " + Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join("; ")} |\n`);
process.exit(pass ? 0 : 2);
