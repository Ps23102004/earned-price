// Route-level Suspense boundary: the receipt reads params, cookies and PayPal at request time, so the static shell is this.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <h1 className="text-xl font-semibold tracking-tight">Receipt</h1>
      <p className="text-sm text-stone-500 dark:text-stone-400">Reading your payment from PayPal…</p>
    </div>
  );
}
