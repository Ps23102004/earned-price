import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { paypal } from "@/paypal/client";
import { getSession } from "@/session";
import { verifyCustomId } from "@/store/custom-id";
import { getOrderForSession, reconcileOrder } from "@/store/orders";
import { claimHashFor } from "@/store/refunds";
import { CopyButton } from "../../_components/copy-button";
import { Chip, Notice, buttonClass, card } from "../../_components/ui";
import { ClaimPanel } from "./claim-panel";

export const metadata: Metadata = { title: "Receipt — Earned Price" };

// Everything money-related below comes from PayPal's own response, never from our database.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const money = (m: Json): string | null =>
  m && m.value !== undefined ? `${String(m.value)} ${String(m.currency_code ?? "")}`.trim() : null;

export default async function Receipt({ params }: PageProps<"/receipt/[id]">) {
  const { id } = await params;

  const session = await getSession().catch((err) => {
    console.error("receipt: no session:", err instanceof Error ? err.message : err);
    return null;
  });
  if (!session) notFound();
  const first = await getOrderForSession(id, session.sid);
  if (!first) notFound();

  // Settle anything still in flight, then reload so the state shown is the settled one.
  await reconcileOrder(id, "read").catch((err) => console.error("receipt: reconcile failed:", err instanceof Error ? err.message : err));
  const order = (await getOrderForSession(id, session.sid)) ?? first;

  const retry = (
    <a href={`/receipt/${id}`} className={buttonClass}>
      Refresh
    </a>
  );

  let body: ReactNode;
  if (!order.paypalOrderId) {
    body = <StateNotice state={order.state} />;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let po: { ok: boolean; json: any } | null = null;
    try {
      po = await paypal("GET", `/v2/checkout/orders/${encodeURIComponent(order.paypalOrderId)}`);
    } catch {
      po = null;
    }
    if (!po || !po.ok || !po.json) {
      body = (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="warn">PayPal is unavailable right now — retry</Notice>
          {retry}
        </div>
      );
    } else {
      const claimHash = ["refunding", "refund_pending", "refunded_partial", "mismatch"].includes(order.state) ? await claimHashFor(order.id).catch(() => undefined) : undefined;
      body = <Details order={order} po={po.json} retry={retry} claimHash={claimHash} login={session.github?.login} />;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Receipt</h1>
        <p className="mt-1 break-all font-mono text-xs text-stone-500 dark:text-stone-400">order {order.id}</p>
      </div>
      {body}
      <Link href="/" className="text-sm underline underline-offset-4">
        Back to the shop
      </Link>
    </div>
  );
}

type Order = NonNullable<Awaited<ReturnType<typeof getOrderForSession>>>;

function Details({ order, po, retry, claimHash, login }: { order: Order; po: Json; retry: ReactNode; claimHash?: string; login?: string }) {
  const unit = po.purchase_units?.[0];
  const breakdown = unit?.amount?.breakdown;
  const capture = unit?.payments?.captures?.[0];
  const customId: string | undefined = unit?.custom_id ?? capture?.custom_id;

  // custom_id is "<orderId>:<snapshotHash>": it must name this order and carry the hash recomputed from the stored snapshot.
  const hashOk = verifyCustomId(customId, order.id, order.snapshotJson);

  const showLicence = ["captured", "refunding", "refund_pending", "refunded_partial"].includes(order.state) && hashOk && order.licenceKey;
  const refunds: Json[] = Array.isArray(unit?.payments?.refunds) ? unit.payments.refunds : [];

  return (
    <>
      <StateNotice state={order.state} />
      {order.state === "capturing" || order.state === "refunding" || order.state === "refund_pending" ? retry : null}
      {order.state === "captured" && !order.buyerKey ? <ClaimPanel orderId={order.id} login={login} /> : null}

      {hashOk ? (
        <Notice tone="ok">Fact hash verified</Notice>
      ) : (
        <Notice tone="bad">Fact hash MISMATCH — no licence</Notice>
      )}

      {showLicence ? (
        <section aria-labelledby="licence-heading" className={card}>
          <h2 id="licence-heading" className="text-sm font-semibold">
            Licence key
          </h2>
          <div className="mt-2 flex items-center justify-between gap-3">
            <code className="break-all font-mono text-sm">{order.licenceKey}</code>
            <CopyButton value={order.licenceKey!} label="licence key" />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="paypal-heading" className={card}>
        <h2 id="paypal-heading" className="text-sm font-semibold">
          As recorded by PayPal
        </h2>
        <dl className="mt-3 divide-y divide-stone-200 text-sm dark:divide-stone-800">
          <Row label="Order status" value={po.status} />
          <Row label="Order total" value={money(unit?.amount)} paypalMoney />
          <Row label="Item total" value={money(breakdown?.item_total)} paypalMoney />
          <Row label="Discount" value={breakdown?.discount ? money(breakdown.discount) : "none"} paypalMoney />
          <Row label="Capture id" value={capture?.id} mono />
          <Row label="Capture status" value={capture?.status} />
          <Row label="Capture amount" value={money(capture?.amount)} paypalMoney />
          <Row label="PayPal fee" value={money(capture?.seller_receivable_breakdown?.paypal_fee)} paypalMoney />
          <Row label="custom_id" value={customId} mono />
        </dl>
      </section>

      {refunds.length > 0 ? (
        <section aria-labelledby="refund-heading" className={card}>
          <h2 id="refund-heading" className="text-sm font-semibold">
            Refund, as recorded by PayPal
          </h2>
          {refunds.map((r) => (
            <dl key={String(r.id)} className="mt-3 divide-y divide-stone-200 text-sm dark:divide-stone-800">
              <Row label="Refund id" value={r.id} mono />
              <Row label="Refund status" value={r.status} />
              <Row label="Refund amount" value={money(r.amount)} paypalMoney />
              <Row label="custom_id" value={r.custom_id} mono />
              <div className="py-2">
                {claimHash && r.custom_id === claimHash ? <Notice tone="ok">Claim hash verified</Notice> : <Notice tone="bad">Claim hash MISMATCH</Notice>}
              </div>
            </dl>
          ))}
        </section>
      ) : null}
    </>
  );
}

function Row({
  label,
  value,
  mono,
  paypalMoney,
}: {
  label: string;
  value: unknown;
  mono?: boolean;
  paypalMoney?: boolean;
}) {
  const shown = value === undefined || value === null || value === "" ? "—" : String(value);
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-stone-600 dark:text-stone-400">{label}</dt>
      <dd className="min-w-0 sm:text-right">
        <span className={`break-all ${mono ? "font-mono text-xs" : "font-mono"}`}>{shown}</span>
        {paypalMoney && shown !== "—" && shown !== "none" ? (
          <span className="block text-[11px] text-stone-500 dark:text-stone-400">as recorded by PayPal</span>
        ) : null}
      </dd>
    </div>
  );
}

function StateNotice({ state }: { state: string }) {
  switch (state) {
    case "captured":
      return (
        <div>
          <Chip tone="ok">Payment captured</Chip>
        </div>
      );
    case "capturing":
      return <Notice tone="info">Payment is processing at PayPal — refresh in a few seconds</Notice>;
    case "failed":
      return <Notice tone="bad">Payment failed — you were not charged and no licence was issued.</Notice>;
    case "cancelled":
      return <Notice tone="warn">Payment cancelled — you were not charged and no licence was issued.</Notice>;
    case "expired":
      return <Notice tone="warn">This price quote expired — you were not charged and no licence was issued.</Notice>;
    case "refunding":
      return <Notice tone="info">Your refund is being sent to PayPal — refresh in a few seconds</Notice>;
    case "refund_pending":
      return <Notice tone="info">Your refund is pending at PayPal — refresh later</Notice>;
    case "refunded_partial":
      return (
        <div>
          <Chip tone="ok">Payment captured, refund issued</Chip>
        </div>
      );
    case "mismatch":
      return <Notice tone="bad">Amount mismatch — no licence</Notice>;
    default:
      return <Notice tone="info">This order has not been paid yet — no licence has been issued.</Notice>;
  }
}
