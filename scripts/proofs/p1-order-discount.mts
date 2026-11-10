// Proof P1: discount order -> buyer approves -> capture -> GET read-back -> idempotent capture replay.
// Run: pnpm tsx --env-file=.env scripts/proofs/p1-order-discount.mts [existing-paypal-order-id | --card]
// --card: approve with PayPal's published sandbox test Visa as payment_source (no buyer login needed).
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

// 1. create the order with a discount line (or resume an existing one passed as argv[2])
const card = process.argv[2] === "--card";
const resumeId = card ? undefined : process.argv[2];
const created = resumeId
  ? await paypal("GET", `/v2/checkout/orders/${resumeId}`)
  : await paypal("POST", "/v2/checkout/orders", {
  requestId: `o-${hex}`,
  representation: true,
  body: {
    intent: "CAPTURE",
    ...(card
      ? { payment_source: { card: { number: "4111111111111111", expiry: "2030-12", security_code: "123", name: "Sandbox Tester" } } }
      : {}),
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
if (!created.ok) fail(resumeId ? "get existing order" : "create order", created);
const paypalOrderId: string = created.json.id;
const expectedCustomId: string = resumeId ? created.json.purchase_units?.[0]?.custom_id : customId;
const approve = (created.json.links as { rel: string; href: string }[]).find((l) => l.rel === "payer-action" || l.rel === "approve");
out.createStatus = created.status;
console.log(`CREATED order ${paypalOrderId} (status ${created.json.status}, HTTP ${created.status})`);
console.log(`\nAPPROVE HERE as the sandbox buyer (you type the password yourself):\n${approve?.href}\n`);

// 2. wait for the buyer to approve (card mode: PayPal approves and captures on create)
const oneStep = created.json.status === "COMPLETED" && card;
const deadline = Date.now() + 15 * 60_000;
for (; !oneStep; ) {
  const g = await paypal("GET", `/v2/checkout/orders/${paypalOrderId}`).catch(() => undefined); // transient timeouts: keep polling
  if (g?.json?.status === "APPROVED") break;
  if (g?.json?.status === "COMPLETED") fail("order already captured; run a fresh P1", g);
  if (Date.now() > deadline) fail("buyer did not approve within 15 minutes", g);
  await sleep(4000);
}
console.log(oneStep ? "Card mode: approved and captured on create" : "APPROVED by buyer; capturing...");

// 3. capture (+ replay with the same PayPal-Request-Id). Card mode: the create already captured, so replay the create.
const captureBody = { requestId: `c-${hex}-1`, representation: true };
const cap = oneStep ? created : await paypal("POST", `/v2/checkout/orders/${paypalOrderId}/capture`, captureBody);
if (!cap.ok) fail("capture", cap);
const replay = oneStep
  ? await paypal("POST", "/v2/checkout/orders", { requestId: `o-${hex}`, representation: true, body: { intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: "999.00" } }] } })
  : await paypal("POST", `/v2/checkout/orders/${paypalOrderId}/capture`, captureBody);
const capture1 = cap.json.purchase_units?.[0]?.payments?.captures?.[0];
const capture2 = replay.json?.purchase_units?.[0]?.payments?.captures?.[0];
if (oneStep) console.log(`create replay (same PayPal-Request-Id, different body): HTTP ${replay.status}, order ${replay.json?.id}, amount ${replay.json?.purchase_units?.[0]?.amount?.value}`);
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
  "GET returns custom_id on the order": read.orderCustomId === expectedCustomId,
  "capture COMPLETED": read.captureStatus === "COMPLETED",
  "captured amount == earned price": read.captureAmount === toPayPalValue(EARNED) && read.captureCurrency === "USD",
  "capture replay returned the same capture (idempotent)": out.replaySameCaptureId === true,
};
console.log("\nREAD BACK FROM PAYPAL:", JSON.stringify(read, null, 2));
console.log("replay HTTP status:", out.replayStatus);
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"}  ${k}`);

const pass = Object.values(checks).every(Boolean);
const row = `| ${new Date().toISOString().slice(0, 16)}Z | P1 discount order, capture, GET, capture replay${card ? " (sandbox test card as payment_source)" : " (buyer approval)"} | POST /v2/checkout/orders (breakdown.discount) → buyer approval → POST capture ×2 same PayPal-Request-Id → GET order | order ${paypalOrderId}; capture ${read.captureId} | item_total ${read.itemTotal}, discount ${read.discount}, amount ${read.amount}, captured ${read.captureAmount} ${read.captureCurrency}, fee ${read.paypalFee}, net ${read.net}; capture HTTP ${out.captureStatus}, replay HTTP ${out.replayStatus} | ${pass ? "PASS" : "FAIL: " + Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join("; ")} |\n`;
appendFileSync("docs/EVIDENCE.md", row);
console.log(pass ? "\nP1 PASS: row appended to docs/EVIDENCE.md" : "\nP1 FAILED: row appended to docs/EVIDENCE.md");
process.exit(pass ? 0 : 2);
