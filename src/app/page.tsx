import { Suspense } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getIronSession } from "iron-session";
import type { SessionData } from "@/session";
import { SAMPLE_NAMES, loadSample } from "@/facts/samples";
import { readback } from "@/rules/readback";
import { DEFAULT_RULE } from "@/rules/presets";
import { CopyButton } from "./_components/copy-button";
import { ResetDemo } from "./_components/reset-demo";
import { TheRule } from "./_components/the-rule";
import type { SampleName } from "./_components/types";
import { card } from "./_components/ui";
import { Orders, ShopClient } from "./shop-client";

const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "";

// Reads the session cookie only (never creates one). Request-time only: unsealing the cookie reads the clock.
async function readSession() {
  await connection();
  return getIronSession<SessionData>(await cookies(), {
    cookieName: "ep_session",
    password: process.env.SESSION_SECRET as string,
  }).catch(() => undefined);
}

// Shows the orders list when this browser has orders.
async function YourOrders() {
  const s = await readSession();
  return s?.hasOrders ? <Orders /> : null;
}

// Recorded dates of the committed sample snapshots (static data, so part of the prerendered shell).
const sampleDates = Object.fromEntries(SAMPLE_NAMES.map((n) => [n, loadSample(n).recordedAt])) as Partial<
  Record<SampleName, string>
>;

// The shop with the signed-in identity; only this part reads the cookie.
async function Shop() {
  const s = await readSession();
  const g = s?.github; // sealed by the sign-in callback; only login and avatar reach the client
  const identity = g?.login ? { login: g.login, avatarUrl: g.avatarUrl } : null;
  return <ShopClient clientId={clientId} identity={identity} sampleDates={sampleDates} />;
}

// Static shell; the identity and the orders list read the session cookie (inside Suspense).
export default function Home() {
  const judge = process.env.JUDGE_MODE === "1";

  return (
    <div className="flex flex-col gap-6">
      <ol aria-label="How it works" className="grid grid-cols-3 gap-2 text-sm sm:gap-3">
        <Step n={1} title="Prove" body="public GitHub facts" />
        <Step n={2} title="Price" body="code sets the discount" />
        <Step n={3} title="Pay" body="PayPal charges it, receipt read back" />
      </ol>
      <Suspense fallback={<ShopClient clientId={clientId} identity={null} sampleDates={sampleDates} />}>
        <Shop />
      </Suspense>
      <TheRule readback={readback(DEFAULT_RULE)} json={JSON.stringify(DEFAULT_RULE, null, 2)} />
      <Suspense fallback={null}>
        <YourOrders />
      </Suspense>

      {judge ? (
        <>
          <section aria-labelledby="judge-heading" className={card}>
            <h2 id="judge-heading" className="text-sm font-semibold">
              Sandbox buyer for judges
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Credential label="Email" value={process.env.JUDGE_BUYER_EMAIL ?? ""} />
              <Credential label="Password" value={process.env.JUDGE_BUYER_PASSWORD ?? ""} />
            </dl>
            <p className="mt-3 text-xs text-stone-600 dark:text-stone-400">
              PayPal sandbox — no real money. You can also pay with the test card 4111 1111 1111 1111, any future
              expiry, CVV 123.
            </p>
            <ResetDemo />
          </section>
        </>
      ) : null}
    </div>
  );
}

function Credential({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <dt className="text-xs text-stone-500 dark:text-stone-400">{label}</dt>
        <dd className="break-all font-mono">{value || "not configured"}</dd>
      </div>
      {value ? <CopyButton value={value} label={label.toLowerCase()} /> : null}
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="rounded-lg border border-stone-200 p-2.5 sm:p-3 dark:border-stone-800">
      <span className="font-mono text-xs text-stone-500 dark:text-stone-400">{n}</span>
      <p className="font-medium">{title}</p>
      <p className="text-xs text-stone-600 dark:text-stone-400">{body}</p>
    </li>
  );
}
