"use client";

import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from "@paypal/react-paypal-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { PriceBuildUp } from "./_components/price-buildup";
import type { Identity, Quote, SampleName } from "./_components/types";
import { Chip, Notice, buttonClass, card, usd, type Tone } from "./_components/ui";
import { safeAvatarUrl, sampleProvenance } from "./_components/view-model";
import { captureLanding } from "./capture-landing";

type Profile = "github" | "guest" | SampleName;
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

const SAMPLES: { name: SampleName; title: string; body: string }[] = [
  { name: "qualifies", title: "Qualifies", body: "A contributor to a large open-source project. Meets the top tier of the default rule." },
  {
    name: "nearly",
    title: "Nearly qualifies",
    body: "Close to the default rule's top tier, with one fact short. Shows exactly what is missing.",
  },
  {
    name: "loophole",
    title: "Loophole account (top tier now blocked)",
    body: "Won 50% under the first draft of the rule by merging into its own repositories; the default rule excludes own repositories, so that tier is not met.",
  },
];

const secondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-stone-300 px-4 text-sm font-medium hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:hover:bg-stone-800";

const linkButton =
  "inline-flex min-h-11 items-center rounded text-sm text-stone-600 underline underline-offset-2 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-stone-400 dark:hover:text-stone-100";

function SigninMessage() {
  const v = useSearchParams().get("signin");
  if (v === "failed")
    return <Notice tone="bad">GitHub sign-in did not complete. Try again, or use a recorded sample profile.</Notice>;
  if (v === "cancelled")
    return <Notice tone="warn">Sign-in cancelled. You can try again, use a sample profile, or continue as guest.</Notice>;
  return null;
}

function StepHeading({ n, id, children }: { n: number; id: string; children: string }) {
  return (
    <h2 id={id} className="flex items-baseline gap-2 text-sm font-semibold">
      <span className="font-mono text-xs text-stone-500 dark:text-stone-400">{n}</span>
      {children}
    </h2>
  );
}

export function ShopClient({
  clientId,
  identity,
  sampleDates,
}: {
  clientId: string;
  identity: Identity | null;
  sampleDates: Partial<Record<SampleName, string>>;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const sdkOptions = useMemo(() => ({ clientId, currency: "USD", intent: "capture" }), [clientId]);
  const quoting = phase === "quoting";
  const avatar = safeAvatarUrl(identity?.avatarUrl);
  const priceRef = useRef<HTMLElement>(null);

  // The price card sits below the profile list; bring it into view when pricing starts.
  useEffect(() => {
    if (phase !== "quoting") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    priceRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [phase]);

  async function getPrice(p: Profile) {
    setPhase("quoting");
    setProfile(p);
    setQuote(null);
    setProblem(null);
    try {
      const r = await postJson("/api/quote", p === "github" || p === "guest" ? undefined : { sample: p });
      if (!r.ok) throw new Error(r.json.error ?? `HTTP ${r.status}`);
      setQuote({ ...r.json, truncated: r.json.truncated === true });
      setPhase("quoted");
    } catch (e) {
      setProblem(`Could not get a price quote: ${errText(e)}`);
      setPhase("idle");
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      const r = await postJson("/api/auth/logout");
      if (!r.ok) throw new Error(r.json.error ?? `HTTP ${r.status}`);
      setQuote(null);
      setProfile(null);
      setPhase("idle");
      router.refresh();
    } catch (e) {
      setProblem(`Could not sign out: ${errText(e)}`);
    } finally {
      setSigningOut(false);
    }
  }

  async function createOrder() {
    const r = await postJson("/api/paypal/create", { orderId: quote!.orderId });
    if (!r.ok) throw new Error(r.json.message ?? r.json.error ?? `HTTP ${r.status}`);
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
    if (r.ok && r.json.restart) {
      setConfirming(false);
      actions.restart();
      return;
    }
    // Any reply naming an order (a 409 mismatch included) may mean money moved: show that receipt, never "not charged".
    const receipt = captureLanding(r.status, r.json, quote!.orderId);
    if (!receipt) {
      setConfirming(false);
      throw new Error(r.json.error ?? `HTTP ${r.status}`);
    }
    router.push(`/receipt/${receipt}`);
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

  const showQuote = quote !== null && phase !== "quoting" && phase !== "idle";

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="product-heading" className={card}>
        <h2 id="product-heading" className="text-xl font-semibold tracking-tight">
          Earned Price demo licence
        </h2>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          A checkout where the price is computed from your public GitHub facts, read live when the price is quoted — no coupon codes. List price for everyone else; the merchant chooses the rule.
        </p>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="font-mono text-3xl font-semibold">$49.00</span>
          <span className="text-xs text-stone-500 dark:text-stone-400">list price</span>
        </div>
      </section>

      <section id="prove" aria-labelledby="prove-heading" className={card}>
        <StepHeading n={1} id="prove-heading">
          Prove
        </StepHeading>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Show public GitHub facts. Signing in asks for no permissions, so we can only see what anyone can already see.
        </p>

        <div className="mt-3 flex flex-col gap-3">
          <Suspense fallback={null}>
            <SigninMessage />
          </Suspense>
          {problem && phase === "idle" ? <Notice tone="bad">{problem}</Notice> : null}

          {identity ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element -- fixed GitHub avatar host, no image optimiser needed
                <img src={avatar} alt="" width={40} height={40} className="h-10 w-10 rounded-full" />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-stone-500 dark:text-stone-400">Signed in with GitHub</p>
                <p className="break-all font-mono text-sm">@{identity.login}</p>
              </div>
              <button type="button" onClick={signOut} disabled={signingOut || quoting} className={linkButton}>
                {signingOut ? "Signing out…" : "Not you? Sign out"}
              </button>
              <button
                type="button"
                onClick={() => getPrice("github")}
                disabled={quoting}
                className={`${buttonClass} w-full sm:w-auto`}
              >
                {quoting && profile === "github" ? "Checking GitHub…" : "Get my price"}
              </button>
            </div>
          ) : (
            <a href="/api/auth/github?returnTo=/" className={`${buttonClass} w-full sm:w-auto sm:self-start`}>
              Sign in with GitHub
            </a>
          )}

          <div>
            <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Or try a sample profile</p>
            <ul className="mt-2 flex flex-col gap-3">
              {SAMPLES.map((s) => (
                <li
                  key={s.name}
                  className="rounded-lg border border-stone-200 p-3 dark:border-stone-800"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id={`sample-${s.name}-title`} className="text-sm font-semibold">
                      {s.title}
                    </h3>
                    {showQuote && profile === s.name ? <Chip tone="info">Showing this sample</Chip> : null}
                  </div>
                  <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{s.body}</p>
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    {sampleProvenance(sampleDates[s.name])}
                  </p>
                  <button
                    type="button"
                    onClick={() => getPrice(s.name)}
                    disabled={quoting}
                    aria-describedby={`sample-${s.name}-title`}
                    className={`${secondaryButton} mt-3 w-full sm:w-auto`}
                  >
                    {quoting && profile === s.name ? "Pricing…" : "Price this sample"}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {identity ? null : (
            <div>
              <button type="button" onClick={() => getPrice("guest")} disabled={quoting} className={linkButton}>
                Continue as guest ($49)
              </button>
            </div>
          )}
        </div>
      </section>

      {quoting || showQuote ? (
        <section ref={priceRef} aria-labelledby="price-heading" className={`${card} scroll-mt-4`}>
          <StepHeading n={2} id="price-heading">
            Price
          </StepHeading>
          {quoting ? (
            <div className="mt-3">
              <Notice tone="info">
                {profile === "github" ? "Checking your public GitHub facts…" : "Pricing from the recorded facts…"}
              </Notice>
            </div>
          ) : quote ? (
            <div className="mt-2">
              <PriceBuildUp key={quote.orderId} quote={quote} />
            </div>
          ) : null}
        </section>
      ) : null}

      {showQuote && quote ? (
        <section aria-labelledby="pay-heading" className={card}>
          <StepHeading n={3} id="pay-heading">
            Pay
          </StepHeading>
          <div className="mt-3 flex flex-col gap-3">
            {phase === "quoted" ? (
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
              <button type="button" onClick={() => getPrice(profile ?? "guest")} className={buttonClass}>
                Start over
              </button>
            ) : null}
            {phase === "quoted" ? (
              <p className="text-xs text-stone-500 dark:text-stone-400">
                PayPal&apos;s buttons can take a few seconds to appear. Want a different price? Pick another profile above to get a new quote.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
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

export function Orders() {
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
          {rows.length === 0 ? <li className="p-3 text-sm text-stone-600 dark:text-stone-300">No orders yet.</li> : null}
          {rows.map((o) => (
            <li key={o.orderId}>
              <Link
                href={`/receipt/${o.orderId}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl p-3 text-sm hover:bg-stone-100 dark:hover:bg-stone-900"
              >
                <span className="font-mono text-xs">{o.orderId.slice(0, 8)}</span>
                {["created", "approved", "capturing"].includes(o.state) ? (
                  <span className="text-xs text-stone-500 dark:text-stone-400">price quote {usd(o.earnedCents)}</span>
                ) : null}
                <Chip tone={stateTone[o.state] ?? "info"}>{o.state}</Chip>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
