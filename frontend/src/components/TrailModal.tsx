"use client";

import { useCallback, useEffect, useState } from "react";
import type { Attestation, DecisionTrail, TrailVerification } from "@/lib/types";
import { api, verifyTrail } from "@/lib/api";
import { txUrl } from "@/lib/config";
import { Badge, Button, Mono, Skeleton } from "@/components/ui/primitives";
import { formatClock, shortHash } from "@/lib/format";
import { canonicalTrailJson } from "@/lib/canonical";
import { useDismissable } from "@/lib/hooks";

/**
 * Reveals the full reasoning trail behind an attestation and re-derives its
 * hash in the browser, so the match against the on-chain commitment is checked
 * here rather than asserted by the backend.
 */
export function TrailModal({
  attestation,
  onClose,
}: {
  attestation: Attestation | null;
  onClose: () => void;
}) {
  if (!attestation) return null;
  // Keyed so each attestation opens with clean state — no effect-driven resets.
  return <TrailModalContent key={attestation.attestationId} attestation={attestation} onClose={onClose} />;
}

function TrailModalContent({
  attestation,
  onClose,
}: {
  attestation: Attestation;
  onClose: () => void;
}) {
  const [trail, setTrail] = useState<DecisionTrail | null>(null);
  const [verification, setVerification] = useState<TrailVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  useDismissable(true, onClose);

  useEffect(() => {
    let cancelled = false;

    api
      .getTrail(attestation.attestationId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setError("No stored trail for this attestation.");
          return;
        }
        setTrail(result);
        setVerification(verifyTrail(result, attestation.trailHash));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load the trail");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attestation]);

  const stop = useCallback((event: React.MouseEvent) => event.stopPropagation(), []);
  const explorer = txUrl(attestation.txHash);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void-900/70 p-0 backdrop-blur-md sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Decision trail for attestation ${attestation.attestationId}`}
    >
      <div
        onClick={stop}
        className="panel max-h-[92vh] w-full max-w-2xl animate-fade-in-up overflow-hidden rounded-b-none sm:rounded-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-ink-900">
                Attestation #{attestation.attestationId}
              </h2>
              <Badge tone="cyan">{attestation.actionType}</Badge>
              {attestation.slashed && <Badge tone="slashed">Slashed</Badge>}
              {attestation.disputed && <Badge tone="disputed">Under dispute</Badge>}
            </div>
            <p className="mt-1 text-xs text-ink-500">
              {attestation.agentName} · {formatClock(attestation.timestamp)}
            </p>
          </div>
          <Button variant="subtle" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>

        <div className="scroll-slim max-h-[calc(92vh-8.5rem)] overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : error ? (
            <p className="py-8 text-center text-xs text-state-slashed">{error}</p>
          ) : trail ? (
            <div className="space-y-5">
              {/* The verification banner is the point of this whole panel. */}
              {verification && (
                <div
                  className={`rounded-lg border px-4 py-3 ${
                    verification.matches
                      ? "border-state-clean/30 bg-state-clean/[0.10]"
                      : "border-state-slashed/40 bg-state-slashed/[0.10]"
                  }`}
                >
                  <p
                    className={`flex items-center gap-2 text-xs font-medium ${
                      verification.matches ? "text-state-clean" : "text-state-slashed"
                    }`}
                  >
                    <span aria-hidden>{verification.matches ? "✓" : "✕"}</span>
                    {verification.matches
                      ? "Trail matches the on-chain commitment"
                      : "Trail does NOT match the on-chain commitment"}
                  </p>
                  <dl className="mt-2 space-y-1 text-[11px]">
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-ink-500">committed</dt>
                      <dd className="min-w-0 break-all">
                        <Mono className="text-ink-600">{verification.committedHash}</Mono>
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-ink-500">recomputed</dt>
                      <dd className="min-w-0 break-all">
                        <Mono className="text-ink-600">{verification.computedHash}</Mono>
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-[10px] leading-relaxed text-ink-500">
                    Recomputed in your browser as keccak256 over the canonical trail JSON — the
                    dashboard does not take the orchestrator&apos;s word for it.
                  </p>
                </div>
              )}

              <Field label="Declared policy">
                <p className="text-xs leading-relaxed text-ink-600">{trail.policy}</p>
              </Field>

              <Field
                label="Reasoning"
                aside={
                  <Badge tone={trail.source === "ollama" ? "cyan" : "muted"}>
                    {trail.source === "ollama" ? `Ollama · ${trail.model ?? "gemma"}` : "Rule-based fallback"}
                  </Badge>
                }
              >
                <p className="text-xs leading-relaxed text-ink-800">{trail.reasoning}</p>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Inputs">
                  <KeyValues data={trail.inputs} />
                </Field>
                <Field label="Output">
                  <KeyValues data={trail.output} />
                </Field>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                  className="text-[11px] text-ink-500 underline-offset-2 hover:text-accent-600 hover:underline"
                >
                  {showRaw ? "Hide" : "Show"} canonical JSON (the exact bytes that were hashed)
                </button>
                {showRaw && (
                  <pre className="scroll-slim mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line-200 bg-black/25 p-3 font-mono text-[10px] leading-relaxed text-ink-600">
                    {canonicalTrailJson({
                      attestationId: trail.attestationId,
                      agentId: trail.agentId,
                      inputs: trail.inputs,
                      nonce: trail.nonce,
                      output: trail.output,
                      policy: trail.policy,
                      reasoning: trail.reasoning,
                    })}
                  </pre>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line-200 px-5 py-3">
          <Mono className="truncate text-ink-500" title={attestation.trailHash}>
            {shortHash(attestation.trailHash)}
          </Mono>
          {explorer ? (
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[11px] text-accent-600 underline-offset-2 hover:underline"
            >
              View transaction ↗
            </a>
          ) : (
            <span className="text-[11px] text-ink-400">No transaction hash recorded</span>
          )}
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[10px] uppercase tracking-wider text-ink-500">{label}</h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

function KeyValues({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <p className="text-xs text-ink-400">—</p>;
  return (
    <dl className="space-y-1 rounded-lg border border-line-200 bg-white/[0.04] px-3 py-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-baseline justify-between gap-3">
          <dt className="text-[11px] text-ink-500">{key}</dt>
          <dd className="min-w-0 truncate text-[11px] tabular-nums text-ink-800" title={String(value)}>
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
