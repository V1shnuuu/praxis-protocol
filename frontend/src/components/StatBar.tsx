"use client";

import { useRef } from "react";
import type { Agent, Attestation, Dispute } from "@/lib/types";
import { Skeleton } from "@/components/ui/primitives";
import { formatPrax } from "@/lib/format";
import { useTilt } from "@/lib/parallax";

/**
 * Protocol-level headline numbers. These are stat tiles, not charts — the
 * value is the message, so no plot earns its place here.
 */
export function StatBar({
  agents,
  attestations,
  disputes,
  loading,
}: {
  agents: Agent[] | null;
  attestations: Attestation[] | null;
  disputes: Dispute[] | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="panel p-4">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="mt-2.5 h-6 w-16" />
          </div>
        ))}
      </div>
    );
  }

  const totalBonded = (agents ?? []).reduce((sum, a) => sum + Number(a.bond), 0);
  const openDisputes = (disputes ?? []).filter((d) => d.status === "open").length;
  const totalSlashed = (disputes ?? [])
    .filter((d) => d.status === "upheld")
    .reduce((sum, d) => sum + Number(d.slashedAmount ?? 0), 0);

  const tiles: { label: string; value: string; sub?: string; tone?: string }[] = [
    {
      label: "Agents bonded",
      value: String(agents?.length ?? 0),
      sub: `${formatPrax(String(totalBonded))} PRAX at stake`,
    },
    {
      label: "Attestations",
      value: String(attestations?.length ?? 0),
      sub: "decisions committed on-chain",
    },
    {
      label: "Open disputes",
      value: String(openDisputes),
      sub: openDisputes > 0 ? "awaiting arbitration" : "none pending",
      tone: openDisputes > 0 ? "text-state-disputed" : undefined,
    },
    {
      label: "Total slashed",
      value: formatPrax(String(totalSlashed)),
      sub: "PRAX burned from bonds",
      tone: totalSlashed > 0 ? "text-state-slashed" : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Tile key={tile.label} {...tile} />
      ))}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useTilt(ref, { max: 4, lift: -3 });

  return (
    <div ref={ref} className="tilt panel panel-interactive px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-ink-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? "text-ink-900"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-ink-500">{sub}</p>}
    </div>
  );
}
