import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Earned Price",
  description: "A checkout where the price is earned from verified public facts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="mx-auto w-full max-w-xl px-4 pt-6">
          <Link href="/" className="rounded font-mono text-sm font-semibold tracking-tight">
            earned-price
          </Link>
        </header>
        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">{children}</main>
        <footer className="mx-auto w-full max-w-xl px-4 pb-8 text-xs text-stone-500 dark:text-stone-400">
          PayPal sandbox — no real money moves.
        </footer>
      </body>
    </html>
  );
}
