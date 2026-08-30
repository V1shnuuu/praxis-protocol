"use client";

import type { Dispute } from "@/lib/types";
import { DisputeCard } from "@/components/DisputeCard";
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/ui/primitives";
import { useTicker } from "@/lib/hooks";

export function DisputeView({
  disputes,
  loading,
  error,
  onRetry,
  onResolve,
  resolvingId,
  challengeWindowSeconds,
}: {
  disputes: Dispute[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onResolve: (disputeId: number, upheld: boolean) => void;
  resolvingId: number | null;
  challengeWindowSeconds: number;
}) {
  const now = useTicker();
  const openCount = disputes?.filter((d) => d.status === "open").length ?? 0;

  return (
    <Panel
      title="Disputes &amp; slashing"
      subtitle={
        openCount > 0
          ? `${openCount} awaiting arbitration`
          : "Challenged attestations and how they resolved"
      }
      flush
      bodyClassName=""
    >
      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : loading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="panel-raised space-y-3 p-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      ) : !disputes || disputes.length === 0 ? (
        <EmptyState
          title="No disputes yet"
          hint="Trigger rogue mode on an agent to watch the watcher open a dispute, the arbiter resolve it, and the bond get slashed."
        />
      ) : (
        <div className="space-y-4">
          {disputes.map((dispute) => (
            <DisputeCard
              key={dispute.disputeId}
              dispute={dispute}
              challengeWindowSeconds={challengeWindowSeconds}
              now={now}
              onResolve={onResolve}
              resolving={resolvingId === dispute.disputeId}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}
