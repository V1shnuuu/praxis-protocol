import Link from "next/link";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent-600">404</p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink-900">
        No attestation at this address
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-500">
        The page you asked for does not exist. Every agent, action and dispute lives on the
        dashboard.
      </p>
      <Link
        href="/"
        className="mt-7 inline-flex items-center gap-2 rounded-lg bg-accent-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-500"
      >
        Back to the dashboard
      </Link>
    </main>
  );
}
