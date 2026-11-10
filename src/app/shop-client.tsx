"use client";

import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Chip, Notice, buttonClass, card, usd, type Tone } from "./_components/ui";

type Quote = { orderId: string; earnedCents: number };
type Phase = "idle" | "quoting" | "quoted" | "cancelled" | "failed";
type MineRow = { orderId: string; state: string; earnedCents: number; createdAt: string };

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));

export function ShopClient({ clientId, showOrders }: { clientId: string; showOrders: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const sdkOptions = useMemo(() => ({ clientId, currency: "USD", intent: "capture" }), [clientId]);

  async function getPrice() {
    setPhase("quoting");
    setProblem(null);
    try {
      const r = await postJson("/api/quote");
      if (!r.ok) throw new Error(r.json.error ?? `HTTP ${r.status}`);
      setQuote({ orderId: r.json.orderId, earnedCents: r.json.earnedCents });
      setPhase("quoted");
    } catch (e) {
      setProblem(`Could not get a price quote: ${errText(e)}`);
      setPhase("idle");
    }
  }

  async function createOrder() {
    const r = await postJson("/api/paypal/create", { orderId: quote!.orderId });
    if (!r.ok) throw new Error(r.json.error ?? `HTTP ${r.status}`);
    return r.json.paypalOrderId as string;
  }

  async function onApprove(data: { orderID: string }, actions: { restart: () => void }) {
    setConfirming(true);
    let r;
    try {
      r = await postJson("/api/paypal/capture", { paypalOrderId: data.orderID });
    } catch {
      // The capture request may have reached PayPal; the receipt page reconciles and shows the truth.
      router.push(`/receipt/${quote!.orderId}`);
      return;
    }
    if (r.status >= 500) {
      router.push(`/receipt/${quote!.orderId}`);
      return;
    }
    if (!r.ok) {
      setConfirming(false);
      throw new Error(r.json.error ?? `HTTP ${r.status}`);
    }
    if (r.json.restart) {
      setConfirming(false);
      actions.restart();
      return;
    }
    router.push(`/receipt/${r.json.orderId}`);
  }

  async function onCancel() {
    setConfirming(false);
    if (quote) await postJson(`/api/orders/${quote.orderId}/cancel`).catch(() => undefined);
    setPhase("cancelled");
  }

  function onError(err: unknown) {
    setConfirming(false);
    setProblem(errText(err));
    setPhase("failed");
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="product-heading" className={card}>
        <h1 id="product-heading" className="text-xl font-semibold tracking-tight">
          Earned Price demo licence
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          A checkout where the price is earned from verified public facts — no coupon codes.
        </p>

        <div className="mt-5 flex items-baseline gap-2">
          {phase === "quoted" && quote ? (
            <>
              <span className="font-mono text-3xl font-semibold">{usd(quote.earnedCents)}</span>
              <span className="text-xs text-stone-500 dark:text-stone-400">price quote</span>
            </>
          ) : (
            <>
              <span className="font-mono text-3xl font-semibold">$49.00</span>
              <span className="text-xs text-stone-500 dark:text-stone-400">list price</span>
            </>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-3">
          {problem && phase === "idle" ? <Notice tone="bad">{problem}</Notice> : null}

          {phase === "idle" || phase === "quoting" ? (
            <button type="button" onClick={getPrice} disabled={phase === "quoting"} className={buttonClass}>
              {phase === "quoting" ? "Getting price…" : "Get price"}
            </button>
          ) : null}

          {phase === "quoted" && quote ? (
            clientId ? (
              <PayPalScriptProvider options={sdkOptions}>
                <Checkout
                  key={quote.orderId}
                  createOrder={createOrder}
                  onApprove={onApprove}
                  onCancel={onCancel}
                  onError={onError}
                />
                {confirming ? <Notice tone="info">Confirming your payment with PayPal…</Notice> : null}
              </PayPalScriptProvider>
            ) : (
              <Notice tone="bad">PayPal is not configured (NEXT_PUBLIC_PAYPAL_CLIENT_ID is missing).</Notice>
            )
          ) : null}

          {phase === "cancelled" ? (
            <Notice tone="warn">Payment cancelled — you were not charged and no licence was issued.</Notice>
          ) : null}
          {phase === "failed" ? (
            <Notice tone="bad">
              <p>Payment failed — you were not charged and no licence was issued.</p>
              {problem ? <p className="mt-1 font-mono text-xs">{problem}</p> : null}
            </Notice>
          ) : null}
          {phase === "cancelled" || phase === "failed" ? (
            <button type="button" onClick={getPrice} className={buttonClass}>
              Start over
            </button>
          ) : null}
        </div>
      </section>

      {showOrders ? <Orders /> : null}
    </div>
  );
}

function Checkout(props: {
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }, actions: { restart: () => void }) => Promise<void>;
  onCancel: () => void;
  onError: (err: unknown) => void;
}) {
  const [{ isPending, isRejected }] = usePayPalScriptReducer();
  if (isRejected) return <Notice tone="bad">Could not load PayPal. Check your connection and reload the page.</Notice>;
  return (
    <div>
      {isPending ? <p className="text-sm text-stone-500 dark:text-stone-400">Loading PayPal…</p> : null}
      <PayPalButtons
        style={{ layout: "vertical", label: "pay" }}
        createOrder={props.createOrder}
        onApprove={props.onApprove}
        onCancel={props.onCancel}
        onError={props.onError}
      />
    </div>
  );
}

const stateTone: Record<string, Tone> = {
  captured: "ok",
  failed: "bad",
  mismatch: "bad",
  cancelled: "warn",
  expired: "warn",
};

function Orders() {
  const [rows, setRows] = useState<MineRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/orders/mine")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => live && setRows(Array.isArray(j) ? j : (j.orders ?? [])))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section aria-labelledby="orders-heading">
      <h2 id="orders-heading" className="text-sm font-semibold">
        Your orders
      </h2>
      {failed ? <p className="mt-2 text-sm text-stone-500">Could not load your orders.</p> : null}
      {rows === null && !failed ? <p className="mt-2 text-sm text-stone-500">Loading…</p> : null}
      {rows ? (
        <ul className="mt-2 divide-y divide-stone-200 rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
          {rows.length === 0 ? <li className="p-3 text-sm text-stone-500">No orders yet.</li> : null}
          {rows.map((o) => (
            <li key={o.orderId}>
              <Link
                href={`/receipt/${o.orderId}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl p-3 text-sm hover:bg-stone-100 dark:hover:bg-stone-900"
              >
                <span className="font-mono text-xs">{o.orderId.slice(0, 8)}</span>
                <span className="text-xs text-stone-500 dark:text-stone-400">price quote {usd(o.earnedCents)}</span>
                <Chip tone={stateTone[o.state] ?? "info"}>{o.state}</Chip>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
