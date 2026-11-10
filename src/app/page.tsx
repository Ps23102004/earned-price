import { Suspense } from "react";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import type { SessionData } from "@/session";
import { CopyButton } from "./_components/copy-button";
import { card } from "./_components/ui";
import { Orders, ShopClient } from "./shop-client";

// Reads the session cookie only (never creates one) and shows the orders list when this browser has orders.
async function YourOrders() {
  const s = await getIronSession<SessionData>(await cookies(), {
    cookieName: "ep_session",
    password: process.env.SESSION_SECRET as string,
  }).catch(() => undefined);
  return s?.hasOrders ? <Orders /> : null;
}

// Static shell; only the orders list reads the session cookie (inside Suspense).
export default async function Home() {
  const judge = process.env.JUDGE_MODE === "1";

  return (
    <div className="flex flex-col gap-6">
      <ShopClient clientId={process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? ""} />
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
          </section>

          <section aria-labelledby="how-heading">
            <h2 id="how-heading" className="text-sm font-semibold">
              How it works
            </h2>
            <ol className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
              <Step n={1} title="Prove" body="public GitHub facts" />
              <Step n={2} title="Price" body="code computes the discount" />
              <Step n={3} title="Pay" body="PayPal charges exactly that; the receipt is read back from PayPal" />
            </ol>
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
    <li className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
      <span className="font-mono text-xs text-stone-500 dark:text-stone-400">{n}</span>
      <p className="font-medium">{title}</p>
      <p className="text-xs text-stone-600 dark:text-stone-400">{body}</p>
    </li>
  );
}
