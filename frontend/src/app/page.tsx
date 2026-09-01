"use client";

import { useCallback, useState } from "react";
import type { Attestation } from "@/lib/types";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { usePolled } from "@/lib/hooks";
import { Header } from "@/components/Header";
import { StatBar } from "@/components/StatBar";
import { DemoControls } from "@/components/DemoControls";
import { AgentList } from "@/components/AgentList";
import { ActionFeed } from "@/components/ActionFeed";
import { DisputeView } from "@/components/DisputeView";
import { ContractPanel } from "@/components/ContractPanel";
import { TrailModal } from "@/components/TrailModal";
import { ParallaxBackground } from "@/components/ParallaxBackground";
import { Hero } from "@/components/Hero";
import { Reveal } from "@/components/Reveal";

export default function DashboardPage() {
  const status = usePolled(useCallback(() => api.getStatus(), []), 15_000);
  const agents = usePolled(useCallback(() => api.getAgents(), []));
  const attestations = usePolled(useCallback(() => api.getAttestations(40), []));
  const disputes = usePolled(useCallback(() => api.getDisputes(), []));

  const [selected, setSelected] = useState<Attestation | null>(null);
  const [rogueBusyId, setRogueBusyId] = useState<number | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const refreshAll = useCallback(() => {
    agents.refresh();
    attestations.refresh();
    disputes.refresh();
  }, [agents, attestations, disputes]);

  const triggerRogue = useCallback(
    async (agentId: number) => {
      setRogueBusyId(agentId);
      setMessage(null);
      try {
        const { attestationId } = await api.triggerRogue(agentId);
        const name = agents.data?.find((a) => a.agentId === agentId)?.name ?? `Agent ${agentId}`;
        setMessage({
          tone: "info",
          text: `${name} committed a policy-violating action as attestation #${attestationId}. Watch the feed — the watcher is opening a dispute.`,
        });
        refreshAll();
      } catch (cause) {
        setMessage({
          tone: "error",
          text: cause instanceof Error ? cause.message : "Could not trigger rogue mode",
        });
      } finally {
        setRogueBusyId(null);
      }
    },
    [agents.data, refreshAll]
  );

  const resolveDispute = useCallback(
    async (disputeId: number, upheld: boolean) => {
      setResolvingId(disputeId);
      setMessage(null);
      try {
        await api.resolveDispute(disputeId, upheld);
        setMessage({
          tone: "info",
          text: upheld
            ? `Dispute #${disputeId} upheld — the agent's bond has been slashed.`
            : `Dispute #${disputeId} rejected — the challenger forfeited their fee to the agent.`,
        });
        refreshAll();
      } catch (cause) {
        setMessage({
          tone: "error",
          text: cause instanceof Error ? cause.message : "Could not resolve the dispute",
        });
      } finally {
        setResolvingId(null);
      }
    },
    [refreshAll]
  );

  const resetDemo = useCallback(async () => {
    if (!api.reset) return;
    await api.reset();
    setMessage({ tone: "info", text: "Demo reset. Every agent is back to its opening bond." });
    refreshAll();
  }, [refreshAll]);

  const challengeWindow = status.data?.challengeWindowSeconds ?? 300;

  return (
    <div className="flex min-h-dvh flex-col">
      <ParallaxBackground />
      <Header status={status.data} />

      <Hero />

      <main
        id="dashboard"
        className="mx-auto w-full max-w-[1600px] flex-1 space-y-4 px-4 pb-10 pt-4 sm:space-y-5 sm:px-6 sm:pt-6"
      >
        {config.isDemoMode && <DemoModeBanner />}

        <Reveal>
          <StatBar
            agents={agents.data}
            attestations={attestations.data}
            disputes={disputes.data}
            loading={agents.loading && attestations.loading}
          />
        </Reveal>

        <Reveal delayMs={60}>
          <DemoControls
            agents={agents.data}
            onTriggerRogue={triggerRogue}
            onReset={api.reset ? resetDemo : undefined}
            busy={rogueBusyId !== null}
            lastMessage={message}
          />
        </Reveal>

        <Reveal delayMs={90}>
          <AgentList
            agents={agents.data}
            loading={agents.loading}
            error={agents.error}
            onRetry={agents.refresh}
            onTriggerRogue={triggerRogue}
            rogueBusyId={rogueBusyId}
          />
        </Reveal>

        <Reveal delayMs={60}>
          <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <ActionFeed
              attestations={attestations.data}
              loading={attestations.loading}
              error={attestations.error}
              onRetry={attestations.refresh}
              onSelect={setSelected}
              liveMode={!attestations.error}
            />
            <div className="flex min-h-0 flex-col gap-4 sm:gap-5">
              <DisputeView
                disputes={disputes.data}
                loading={disputes.loading}
                error={disputes.error}
                onRetry={disputes.refresh}
                onResolve={resolveDispute}
                resolvingId={resolvingId}
                challengeWindowSeconds={challengeWindow}
              />
              <ContractPanel status={status.data} />
            </div>
          </div>
        </Reveal>
      </main>

      <footer className="mt-8 border-t border-line-300 px-6 py-8 text-center text-[11px] text-ink-400">
        Praxis Protocol · agents bond against a declared policy, commit hashed decision trails, and
        lose stake when they break it
      </footer>

      <TrailModal attestation={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function DemoModeBanner() {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-state-disputed/25 bg-state-disputed/[0.05] px-4 py-2.5 text-[11px] leading-relaxed">
      <span className="font-medium text-state-disputed">Demo mode.</span>
      <span className="text-ink-500">
        No orchestrator is configured, so agents, attestations and disputes are simulated in your
        browser. Trail hashes are real keccak256 digests and are verified client-side. Set
      </span>
      <code className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-ink-600 ring-1 ring-inset ring-white/10">
        NEXT_PUBLIC_API_URL
      </code>
      <span className="text-ink-500">to run against the live FastAPI backend.</span>
    </div>
  );
}
