import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { readback } from "@/rules/readback";
import { loadRuleRow } from "@/store/rules";
import { card } from "../../_components/ui";
import { AdoptButton } from "./adopt-button";

export const metadata: Metadata = { title: "Earned-price checkout — Earned Price" };

// A merchant's published rule as a link anyone can open. The link carries only the rule's id; opening it sets that
// rule for this browser's checkout (the same thing the merchant's Publish does for theirs). Nothing is charged here.
export default function ShopLink({ params }: PageProps<"/shop/[ruleId]">) {
  return (
    <Suspense fallback={<p className="text-sm text-stone-600 dark:text-stone-400">Loading this merchant&apos;s rule…</p>}>
      <ShopLinkBody params={params} />
    </Suspense>
  );
}

async function ShopLinkBody({ params }: { params: PageProps<"/shop/[ruleId]">["params"] }) {
  await connection();
  const { ruleId } = await params;
  const row = await loadRuleRow(ruleId).catch(() => undefined);
  if (!row) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold tracking-tight">This checkout link is not valid</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">The rule it points to does not exist or is no longer valid. Nothing was charged.</p>
        <Link href="/" className="text-sm underline underline-offset-4">
          Go to the shop
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">An earned-price checkout</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          This merchant prices the $49.00 licence by what you can prove from public GitHub facts. No code to enter.
        </p>
      </div>
      <section aria-labelledby="rule-heading" className={card}>
        <h2 id="rule-heading" className="text-sm font-semibold">
          The merchant&apos;s rule, in plain English
        </h2>
        <p className="mt-2 whitespace-pre-line break-words text-sm">{readback(row.rule)}</p>
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
          Written by code from the validated rule. Your price is computed by code from your own public facts; PayPal sandbox charges exactly that.
        </p>
      </section>
      <AdoptButton ruleId={row.id} />
    </div>
  );
}
