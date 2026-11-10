// Proof P1: discount order -> buyer approves -> capture -> GET read-back -> idempotent capture replay.
// Run: pnpm tsx --env-file=.env scripts/proofs/p1-order-discount.ts
// Every figure below is read back from PayPal. Appends one row to docs/EVIDENCE.md.

import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { paypal } from "../../src/paypal/client";
import { toPayPalValue } from "../../src/paypal/money";

const LIST = 4900;
const EARNED = 2450;
const orderId = randomUUID();
const hex = orderId.replaceAll("-", "");
const customId = `${orderId}:${"0".repeat(64)}`; // 101 chars; stands in for the fact-snapshot hash
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const out: Record<string, unknown> = {};
const fail = (msg: string, r?: { status: number; json: unknown; debugId?: string }): never => {
  console.error(`FAIL: ${msg}`, r ? `HTTP ${r.status} debug_id=${r.debugId} ${JSON.stringify(r.json).slice(0, 600)}` : "");
  process.exit(1);
};

// 1. create the order with a discount line
const created = await paypal("POST", "/v2/checkout/orders", {
  requestId: `o-${hex}`,
  representation: true,
  body: {
    intent: "CAPTURE",
    purchase_units: [
      {
        invoice_id: orderId,
        custom_id: customId,
        items: [{ name: "Developer tool licence", quantity: "1", unit_amount: { currency_code: "USD", value: toPayPalValue(LIST) } }],
        amount: {
          currency_code: "USD",
          value: toPayPalValue(EARNED),
          breakdown: {
            item_total: { currency_code: "USD", value: toPayPalValue(LIST) },
            discount: { currency_code: "USD", value: toPayPalValue(LIST - EARNED) },
          },
        },
      },
    ],
  },
});
if (!created.ok) fail("create order", created);
const paypalOrderId: string = created.json.id;
const approve = (created.json.links as { rel: string; href: string }[]).find((l) => l.rel === "payer-action" || l.rel === "approve");
out.createStatus = created.status;
console.log(`CREATED order ${paypalOrderId} (status ${created.json.status}, HTTP ${created.status})`);
console.log(`\nAPPROVE HERE as the sandbox buyer (you type the password yourself):\n${approve?.href}\n`);

// 2. wait for the buyer to approve
const deadline = Date.now() + 15 * 60_000;
for (;;) {
  const g = await paypal("GET", `/v2/checkout/orders/${paypalOrderId}`);
  if (g.json?.status === "APPROVED") break;
  if (Date.now() > deadline) fail("buyer did not approve within 15 minutes", g);
  await sleep(4000);
}
console.log("APPROVED by buyer; capturing...");

// 3. capture (+ replay with the same PayPal-Request-Id)
const captureBody = { requestId: `c-${hex}-1`, representation: true };
const cap = await paypal("POST", `/v2/checkout/orders/${paypalOrderId}/capture`, captureBody);
if (!cap.ok) fail("capture", cap);
const replay = await paypal("POST", `/v2/checkout/orders/${paypalOrderId}/capture`, captureBody);
const capture1 = cap.json.purchase_units?.[0]?.payments?.captures?.[0];
const capture2 = replay.json?.purchase_units?.[0]?.payments?.captures?.[0];
out.captureStatus = cap.status;
out.replayStatus = replay.status;
out.replaySameCaptureId = capture1?.id !== undefined && capture1?.id === capture2?.id;

// 4. read the order back
const got = await paypal("GET", `/v2/checkout/orders/${paypalOrderId}`);
if (!got.ok) fail("get order", got);
const pu = got.json.purchase_units?.[0];
const cp = pu?.payments?.captures?.[0];
const read = {
  orderStatus: got.json.status,
  amount: pu?.amount?.value,
  itemTotal: pu?.amount?.breakdown?.item_total?.value,
  discount: pu?.amount?.breakdown?.discount?.value,
  orderCustomId: pu?.custom_id,
  captureId: cp?.id,
  captureStatus: cp?.status,
  captureAmount: cp?.amount?.value,
  captureCurrency: cp?.amount?.currency_code,
  captureCustomId: cp?.custom_id,
  paypalFee: cp?.seller_receivable_breakdown?.paypal_fee?.value,
  net: cp?.seller_receivable_breakdown?.net_amount?.value,
};
const checks = {
  "GET returns breakdown.discount": read.discount === toPayPalValue(LIST - EARNED),
  "GET returns breakdown.item_total": read.itemTotal === toPayPalValue(LIST),
  "GET returns custom_id on the order": read.orderCustomId === customId,
  "capture COMPLETED": read.captureStatus === "COMPLETED",
  "captured amount == earned price": read.captureAmount === toPayPalValue(EARNED) && read.captureCurrency === "USD",
  "capture replay returned the same capture (idempotent)": out.replaySameCaptureId === true,
};
console.log("\nREAD BACK FROM PAYPAL:", JSON.stringify(read, null, 2));
console.log("replay HTTP status:", out.replayStatus);
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"}  ${k}`);

const pass = Object.values(checks).every(Boolean);
const row = `| ${new Date().toISOString().slice(0, 16)}Z | P1 discount order, capture, GET, capture replay | POST /v2/checkout/orders (breakdown.discount) → buyer approval → POST capture ×2 same PayPal-Request-Id → GET order | order ${paypalOrderId}; capture ${read.captureId} | item_total ${read.itemTotal}, discount ${read.discount}, amount ${read.amount}, captured ${read.captureAmount} ${read.captureCurrency}, fee ${read.paypalFee}, net ${read.net}; capture HTTP ${out.captureStatus}, replay HTTP ${out.replayStatus} | ${pass ? "PASS" : "FAIL: " + Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join("; ")} |\n`;
appendFileSync("docs/EVIDENCE.md", row);
console.log(pass ? "\nP1 PASS: row appended to docs/EVIDENCE.md" : "\nP1 FAILED: row appended to docs/EVIDENCE.md");
process.exit(pass ? 0 : 2);
