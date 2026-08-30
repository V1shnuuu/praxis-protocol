"use client";

import type { SystemStatus } from "@/lib/types";
import { Badge, Dot } from "@/components/ui/primitives";
import { WalletConnect } from "@/components/WalletConnect";

export function Header({ status }: { status: SystemStatus | null }) {
  const demo = status?.mode === "demo";

  return (
    <header className="sticky top-0 z-40 border-b border-line-300 bg-paper-50/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight text-ink-900">
              Praxis Protocol
            </h1>
            <p className="truncate text-[11px] text-ink-500">
              On-chain accountability for autonomous agents
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {status && (
            <>
              <Badge tone={demo ? "disputed" : "clean"} className="whitespace-nowrap">
                <Dot tone={demo ? "disputed" : "clean"} pulse={!demo} />
                {demo ? "Demo mode" : "Live"}
              </Badge>
              {!demo && (
                <Badge tone="muted" className="hidden whitespace-nowrap sm:inline-flex">
                  {status.network}
                  {status.chainId > 0 && ` · ${status.chainId}`}
                </Badge>
              )}
              <Badge
                tone={status.ollamaAvailable ? "cyan" : "muted"}
                className="hidden whitespace-nowrap md:inline-flex"
              >
                {status.ollamaAvailable ? "Ollama · gemma" : "Rule-based fallback"}
              </Badge>
            </>
          )}
          <WalletConnect status={status} />
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-900 text-white"
      aria-hidden
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        {/* A bond ring around a committed action. */}
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
        <path
          d="M12 6.5v11M7.5 9.5l9 5M16.5 9.5l-9 5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      </svg>
    </span>
  );
}
