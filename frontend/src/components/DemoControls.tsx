"use client";

import { useState } from "react";
import type { Agent } from "@/lib/types";
import { Button } from "@/components/ui/primitives";

/**
 * The one-click demo path: pick an agent, make it break its own declared
 * policy, and let the watcher and arbiter play out on screen. Nothing here
 * needs a terminal.
 */
export function DemoControls({
  agents,
  onTriggerRogue,
  onReset,
  busy,
  lastMessage,
}: {
  agents: Agent[] | null;
  onTriggerRogue: (agentId: number) => void;
  onReset?: () => void;
  busy: boolean;
  lastMessage: { tone: "info" | "error"; text: string } | null;
}) {
  const eligible = (agents ?? []).filter((a) => a.status !== "slashed" && a.status !== "inactive");
  const [selected, setSelected] = useState<number | null>(null);
  const target = selected ?? eligible[0]?.agentId ?? null;
  const targetAgent = eligible.find((a) => a.agentId === target) ?? null;

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-4 border-l-2 border-state-slashed/60 px-4 py-4 sm:px-5 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink-50">Live demo</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-400">
            Make an agent violate the policy it bonded against. A watcher stakes a fee and opens a
            dispute, the arbiter upholds it, and the bond is slashed — the whole loop, on screen, in
            about fifteen seconds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="rogue-agent">
            Agent to send rogue
          </label>
          <select
            id="rogue-agent"
            value={target ?? ""}
            onChange={(event) => setSelected(Number(event.target.value))}
            disabled={eligible.length === 0 || busy}
            className="rounded-lg border border-navy-600 bg-navy-800 px-3 py-2 text-sm text-ink-100 disabled:text-ink-600"
          >
            {eligible.length === 0 ? (
              <option value="">No eligible agents</option>
            ) : (
              eligible.map((agent) => (
                <option key={agent.agentId} value={agent.agentId}>
                  {agent.name}
                </option>
              ))
            )}
          </select>

          <Button
            variant="danger"
            disabled={target === null || busy || targetAgent?.rogue === true}
            onClick={() => target !== null && onTriggerRogue(target)}
            className="shadow-glow"
          >
            {busy ? "Triggering…" : "Trigger rogue agent"}
          </Button>

          {onReset && (
            <Button variant="subtle" size="sm" onClick={onReset} disabled={busy}>
              Reset demo
            </Button>
          )}
        </div>
      </div>

      {lastMessage && (
        <p
          className={`border-t border-navy-700/60 px-4 py-2 text-[11px] sm:px-5 ${
            lastMessage.tone === "error" ? "text-state-slashed" : "text-cyan-400"
          }`}
          role="status"
        >
          {lastMessage.text}
        </p>
      )}
    </section>
  );
}
