"use client";

import type { Agent } from "@/lib/types";
import { AgentCard } from "@/components/AgentCard";
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/ui/primitives";

export function AgentList({
  agents,
  loading,
  error,
  onRetry,
  onTriggerRogue,
  rogueBusyId,
}: {
  agents: Agent[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onTriggerRogue: (agentId: number) => void;
  rogueBusyId: number | null;
}) {
  return (
    <Panel
      title="Registered agents"
      subtitle="Each bonded against a policy it declared at registration"
      flush
      bodyClassName=""
    >
      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="panel-raised space-y-3 p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
      ) : !agents || agents.length === 0 ? (
        <EmptyState
          title="No agents registered"
          hint="Once the orchestrator registers an agent on-chain it appears here with its bond and reputation."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.agentId}
              agent={agent}
              onTriggerRogue={onTriggerRogue}
              rogueBusy={rogueBusyId === agent.agentId}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}
