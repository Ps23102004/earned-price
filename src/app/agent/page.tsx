import type { Metadata } from "next";
import { card } from "../_components/ui";
import { AgentCommands } from "./agent-commands";

export const metadata: Metadata = { title: "For agents — Earned Price" };

// Static: explains the read-only agent interface. The commands (with this site's own address) render on the client.
export default function AgentPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">For shopping agents</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          A coupon code is useless to a shopping agent: it cannot guess one. A published, machine-checkable rule is not. This read-only interface lets an agent read a merchant&apos;s rule and ask what a buyer would pay.
        </p>
      </div>
      <section aria-labelledby="tools-heading" className={card}>
        <h2 id="tools-heading" className="text-sm font-semibold">
          Three tools (Model Context Protocol, HTTP)
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <code className="font-mono">get_rule</code> — the rule in plain English and as validated JSON.
          </li>
          <li>
            <code className="font-mono">preview_price</code> — what a recorded sample profile or a public GitHub login would pay, computed by the same code as the checkout. No order is created and nothing is charged.
          </li>
          <li>
            <code className="font-mono">get_checkout_link</code> — the link the buyer opens to pay.
          </li>
        </ul>
        <p className="mt-3 text-xs text-stone-600 dark:text-stone-400">
          It cannot create an order or pay. Paying needs the buyer&apos;s own GitHub sign-in (no permissions) and their PayPal approval. Live GitHub lookups are rate limited; samples are not.
        </p>
      </section>
      <AgentCommands />
    </div>
  );
}
