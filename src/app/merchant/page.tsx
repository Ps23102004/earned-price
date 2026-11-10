import Link from "next/link";
import { MerchantClient } from "./merchant-client";

// Static shell. This browser's published rule is loaded by the client from /api/merchant/active.
export default function MerchantPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold">Merchant view</h1>
        <Link href="/" className="text-sm underline underline-offset-4">
          Back to shop
        </Link>
      </header>
      <MerchantClient />
    </div>
  );
}
