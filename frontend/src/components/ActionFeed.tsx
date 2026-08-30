"use client";

import type { Attestation } from "@/lib/types";
import { Badge, Dot, EmptyState, ErrorState, Mono, Panel, Skeleton } from "@/components/ui/primitives";
import { shortHash, timeAgo } from "@/lib/format";
import { useTicker } from "@/lib/hooks";

const ACTION_TONE = {
  TRADE: "cyan",
  VOTE: "neutral",
  LOAN: "muted",
} as const;

export function ActionFeed({
  attestations,
  loading,
  error,
  onRetry,
  onSelect,
  liveMode,
}: {
  attestations: Attestation[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (attestation: Attestation) => void;
  liveMode: boolean;
}) {
  // Drives relative timestamps without re-fetching.
  const now = useTicker();

  return (
    <Panel
      title="Live action feed"
      subtitle="Every decision, hashed and committed on-chain"
      action={
        <span className="flex items-center gap-1.5 text-[11px] text-ink-500">
          <Dot tone={liveMode ? "clean" : "muted"} pulse={liveMode} />
          {liveMode ? "Streaming" : "Paused"}
        </span>
      }
      className="max-h-[32rem] xl:max-h-[44rem]"
      bodyClassName="flex min-h-0 flex-col"
    >
      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : loading ? (
        <ul className="space-y-2 p-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
            </li>
          ))}
        </ul>
      ) : !attestations || attestations.length === 0 ? (
        <EmptyState
          title="No attestations yet"
          hint="As agents make decisions, each one is hashed and committed on-chain. They will stream in here."
        />
      ) : (
        <ul className="scroll-slim min-h-0 flex-1 divide-y divide-line-300/40 overflow-y-auto">
          {attestations.map((attestation) => (
            <FeedRow
              key={attestation.attestationId}
              attestation={attestation}
              now={now}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FeedRow({
  attestation,
  now,
  onSelect,
}: {
  attestation: Attestation;
  now: number;
  onSelect: (attestation: Attestation) => void;
}) {
  const violating = attestation.policyViolation;
  const tone = attestation.slashed
    ? "slashed"
    : attestation.disputed
      ? "disputed"
      : violating
        ? "disputed"
        : "clean";

  return (
    <li className="animate-fade-in-up">
      <button
        type="button"
        onClick={() => onSelect(attestation)}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-100/50 ${
          violating ? "bg-state-slashed/[0.06]" : ""
        }`}
        aria-label={`Reveal decision trail for attestation ${attestation.attestationId}`}
      >
        <span className="mt-1.5 shrink-0">
          <Dot tone={tone} pulse={attestation.disputed} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-xs font-medium text-ink-900">{attestation.summary}</span>
            {attestation.slashed && <Badge tone="slashed">Slashed</Badge>}
            {attestation.disputed && <Badge tone="disputed">Disputed</Badge>}
            {violating && !attestation.slashed && !attestation.disputed && (
              <Badge tone="disputed">Policy violation</Badge>
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-500">
            <span className="text-ink-600">{attestation.agentName}</span>
            <span aria-hidden>·</span>
            <Badge tone={ACTION_TONE[attestation.actionType]}>{attestation.actionType}</Badge>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{timeAgo(attestation.timestamp, now)}</span>
            <span aria-hidden>·</span>
            <Mono className="text-ink-400" title={attestation.trailHash}>
              {shortHash(attestation.trailHash)}
            </Mono>
          </span>
        </span>

        <span className="mt-0.5 shrink-0 text-[10px] text-ink-400 transition-colors group-hover:text-accent-600">
          #{attestation.attestationId}
        </span>
      </button>
    </li>
  );
}
