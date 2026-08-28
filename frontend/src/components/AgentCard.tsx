"use client";

import { useState } from "react";
import type { Agent } from "@/lib/types";
import { Badge, Button, Dot, Mono } from "@/components/ui/primitives";
import { ReputationTrend } from "@/components/ReputationTrend";
import { formatPrax, shortAddress } from "@/lib/format";

const STATUS = {
  active: { tone: "clean", label: "Active" },
  disputed: { tone: "disputed", label: "Under dispute" },
  slashed: { tone: "slashed", label: "Slashed" },
  inactive: { tone: "muted", label: "Inactive" },
} as const;

const KIND_LABEL = {
  trading: "Trading",
  "dao-voting": "DAO voting",
  lending: "Lending",
} as const;

export function AgentCard({
  agent,
  onTriggerRogue,
  rogueBusy,
}: {
  agent: Agent;
  onTriggerRogue: (agentId: number) => void;
  rogueBusy: boolean;
}) {
  const [policyOpen, setPolicyOpen] = useState(false);
  const status = STATUS[agent.status];
  const locked = Number(agent.lockedBond) > 0;
  const canGoRogue = agent.status !== "slashed" && agent.status !== "inactive" && !agent.rogue;

  return (
    <article
      className={`panel-raised flex flex-col gap-4 p-4 transition-colors ${
        agent.status === "disputed" ? "ring-1 ring-state-disputed/40" : ""
      } ${agent.status === "slashed" ? "ring-1 ring-state-slashed/30" : ""}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink-50">{agent.name}</h3>
            <Badge tone="muted">{KIND_LABEL[agent.kind]}</Badge>
            {agent.rogue && (
              <Badge tone="slashed" className="animate-pulse-ring">
                Rogue mode
              </Badge>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-400">
            <Dot tone={status.tone} pulse={agent.status === "disputed"} />
            <span>{status.label}</span>
            <span aria-hidden>·</span>
            <Mono className="text-ink-400">#{agent.agentId}</Mono>
            <span aria-hidden>·</span>
            <Mono className="text-ink-400" title={agent.owner}>
              {shortAddress(agent.owner)}
            </Mono>
          </div>
        </div>
        <Badge tone={agent.tier === "TRUSTED" || agent.tier === "RELIABLE" ? "clean" : agent.tier === "NEUTRAL" ? "cyan" : "slashed"}>
          {agent.tier}
        </Badge>
      </header>

      {/* Declared policy: the thing the agent is accountable to. */}
      <div>
        <button
          type="button"
          onClick={() => setPolicyOpen((open) => !open)}
          className="group flex w-full items-start gap-2 rounded-md text-left"
          aria-expanded={policyOpen}
        >
          <span className="mt-0.5 shrink-0 text-[10px] uppercase tracking-wider text-ink-400">Policy</span>
          <span
            className={`flex-1 text-xs leading-relaxed text-ink-200 ${policyOpen ? "" : "line-clamp-2"}`}
          >
            {agent.policy}
          </span>
        </button>
      </div>

      <dl className="grid grid-cols-3 gap-3 border-t border-navy-700/50 pt-3">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-ink-400">Bond</dt>
          <dd className="mt-1 text-sm font-medium tabular-nums text-ink-50">
            {formatPrax(agent.bond)}
            <span className="ml-1 text-[10px] font-normal text-ink-400">PRAX</span>
          </dd>
          {locked && (
            <dd className="mt-0.5 text-[10px] tabular-nums text-state-disputed">
              {formatPrax(agent.lockedBond)} locked
            </dd>
          )}
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-ink-400">Attestations</dt>
          <dd className="mt-1 text-sm font-medium tabular-nums text-ink-50">
            {agent.attestationCount}
            <span className="ml-1 text-[10px] font-normal text-ink-400">
              / {agent.cleanAttestationCount} clean
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-ink-400">Slashes</dt>
          <dd
            className={`mt-1 text-sm font-medium tabular-nums ${
              agent.slashCount > 0 ? "text-state-slashed" : "text-ink-50"
            }`}
          >
            {agent.slashCount}
          </dd>
        </div>
      </dl>

      <div className="flex items-end justify-between gap-3 border-t border-navy-700/50 pt-3">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">Reputation</p>
          <ReputationTrend history={agent.reputationHistory} score={agent.reputation} />
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={!canGoRogue || rogueBusy}
          className="hover:text-state-slashed"
          onClick={() => onTriggerRogue(agent.agentId)}
          title={
            canGoRogue
              ? `Make ${agent.name} violate its declared policy`
              : agent.rogue
                ? "Already running the rogue sequence"
                : "This agent has been slashed out and can no longer act"
          }
        >
          {agent.rogue ? "Running…" : "Go rogue"}
        </Button>
      </div>
    </article>
  );
}
