"use client";

import type { SystemStatus } from "@/lib/types";
import { EmptyState, Mono, Panel } from "@/components/ui/primitives";
import { addressUrl } from "@/lib/config";
import { formatPrax, shortAddress } from "@/lib/format";

/**
 * Proof the dashboard is pointed at real contracts. Reads whatever the backend
 * reports from deployed-addresses.json; says so plainly when nothing is deployed.
 */
export function ContractPanel({ status }: { status: SystemStatus | null }) {
  const contracts = status?.contracts ? Object.entries(status.contracts) : [];

  return (
    <Panel
      title="On-chain deployment"
      subtitle={status?.mode === "demo" ? "Simulation — no contracts attached" : status?.network}
      bodyClassName="p-4 sm:p-5"
    >
      {contracts.length === 0 ? (
        <EmptyState
          title={status?.mode === "demo" ? "Running without a chain" : "No deployment recorded"}
          hint={
            status?.mode === "demo"
              ? "The dashboard is driving itself from an in-browser simulation. Point NEXT_PUBLIC_API_URL at the orchestrator to show live contracts."
              : "Deploy the contracts and commit deployed-addresses.json, and the addresses will appear here with explorer links."
          }
        />
      ) : (
        <>
          <dl className="space-y-2">
            {contracts.map(([name, address]) => {
              const url = addressUrl(address);
              return (
                <div key={name} className="flex items-center justify-between gap-3">
                  <dt className="truncate text-xs text-ink-600">{name}</dt>
                  <dd className="shrink-0">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-accent-600 underline-offset-2 hover:underline"
                      >
                        <Mono title={address}>{shortAddress(address)}</Mono>
                      </a>
                    ) : (
                      <Mono className="text-ink-500" title={address}>
                        {shortAddress(address)}
                      </Mono>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>

          {status && (
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line-200 pt-3 text-[11px]">
              <Param label="Min bond" value={`${formatPrax(status.minBond)} PRAX`} />
              <Param label="Slash on upheld" value={`${status.slashBps / 100}%`} />
              <Param label="Challenge window" value={`${status.challengeWindowSeconds}s`} />
              <Param label="Block" value={status.blockNumber ? String(status.blockNumber) : "—"} />
            </dl>
          )}
        </>
      )}
    </Panel>
  );
}

function Param({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-500">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums text-ink-800">{value}</dd>
    </div>
  );
}
