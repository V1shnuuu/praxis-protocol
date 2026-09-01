"use client";

import type { Dispute } from "@/lib/types";
import { Badge, Button, Mono } from "@/components/ui/primitives";
import { txUrl } from "@/lib/config";
import { formatDelta, formatPrax, secondsRemaining, shortAddress, timeAgo } from "@/lib/format";

const STATUS_META = {
  open: { tone: "disputed", label: "Open — awaiting arbitration" },
  upheld: { tone: "slashed", label: "Upheld — bond slashed" },
  rejected: { tone: "clean", label: "Rejected — challenger forfeited fee" },
} as const;

export function DisputeCard({
  dispute,
  challengeWindowSeconds,
  now,
  onResolve,
  resolving,
}: {
  dispute: Dispute;
  challengeWindowSeconds: number;
  now: number;
  onResolve: (disputeId: number, upheld: boolean) => void;
  resolving: boolean;
}) {
  const meta = STATUS_META[dispute.status];
  const isOpen = dispute.status === "open";
  const remaining = secondsRemaining(dispute.openedAt, challengeWindowSeconds, now);

  const bondAfter = dispute.bondAfter;
  const repAfter = dispute.reputationAfter;
  const slashed = dispute.status === "upheld";

  return (
    <article
      className={`panel overflow-hidden transition-shadow duration-300 ${
        isOpen
          ? "shadow-glass-lift ring-1 ring-state-disputed/45"
          : slashed
            ? "ring-1 ring-state-slashed/35"
            : ""
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink-900">
              Dispute #{dispute.disputeId}
            </h3>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          <p className="mt-1 text-[11px] text-ink-500">
            <span className="text-ink-600">{dispute.agentName}</span> · attestation #
            {dispute.attestationId} · opened {timeAgo(dispute.openedAt, now)}
          </p>
        </div>
        {isOpen && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-ink-500">Window closes</p>
            <p className="text-sm font-medium tabular-nums text-state-disputed">
              {remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "closed"}
            </p>
          </div>
        )}
      </header>

      <div className="space-y-4 px-4 py-4">
        {/* The allegation, in the challenger's words. */}
        <blockquote className="border-l-2 border-state-disputed/50 pl-3">
          <p className="text-xs leading-relaxed text-ink-800">{dispute.reason}</p>
          <footer className="mt-1.5 text-[10px] text-ink-500">
            challenged by <Mono className="text-ink-500">{shortAddress(dispute.challenger)}</Mono> ·
            staked {formatPrax(dispute.fee)} PRAX
          </footer>
        </blockquote>

        {/* Before / after — the moment the whole protocol exists to produce. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg border border-line-200 bg-white/[0.04] p-3 sm:gap-4 sm:p-4">
          <BeforeAfterColumn
            label="Before"
            bond={dispute.bondBefore}
            reputation={dispute.reputationBefore}
          />
          <div className="flex flex-col items-center gap-1 text-ink-400" aria-hidden>
            <span className="text-lg leading-none">→</span>
          </div>
          {bondAfter !== null && repAfter !== null ? (
            <BeforeAfterColumn
              label="After"
              bond={bondAfter}
              reputation={repAfter}
              bondDelta={formatDelta(dispute.bondBefore, bondAfter)}
              repDelta={repAfter - dispute.reputationBefore}
              emphasis={slashed ? "loss" : "gain"}
            />
          ) : (
            <div className="opacity-50">
              <p className="text-[10px] uppercase tracking-wider text-ink-500">After</p>
              <p className="mt-1 text-sm text-ink-400">pending resolution</p>
            </div>
          )}
        </div>

        {slashed && dispute.slashedAmount && (
          <dl className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="rounded-lg bg-state-slashed/[0.10] px-3 py-2">
              <dt className="text-ink-500">Bond slashed</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums text-state-slashed">
                {formatPrax(dispute.slashedAmount)} PRAX
              </dd>
            </div>
            <div className="rounded-lg bg-state-clean/[0.10] px-3 py-2">
              <dt className="text-ink-500">Paid to challenger</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums text-state-clean">
                {formatPrax(dispute.challengerPayout)} PRAX
              </dd>
            </div>
          </dl>
        )}

        {dispute.status === "rejected" && (
          <p className="rounded-lg bg-state-clean/[0.10] px-3 py-2 text-[11px] leading-relaxed text-ink-600">
            The challenge was rejected. The staked fee was forfeited into the agent&apos;s bond, so an
            honest agent ends up better off than before the accusation.
          </p>
        )}

        {isOpen && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line-200 pt-3">
            <span className="mr-auto text-[10px] text-ink-500">Arbiter action</span>
            <Button
              size="sm"
              variant="danger"
              disabled={resolving}
              onClick={() => onResolve(dispute.disputeId, true)}
            >
              Uphold &amp; slash
            </Button>
            <Button size="sm" disabled={resolving} onClick={() => onResolve(dispute.disputeId, false)}>
              Reject
            </Button>
          </div>
        )}

        {(dispute.openTxHash || dispute.resolveTxHash) && (
          <div className="flex flex-wrap gap-3 border-t border-line-200 pt-3 text-[11px]">
            <TxLink label="Open tx" hash={dispute.openTxHash} />
            <TxLink label="Resolve tx" hash={dispute.resolveTxHash} />
          </div>
        )}
      </div>
    </article>
  );
}

function BeforeAfterColumn({
  label,
  bond,
  reputation,
  bondDelta,
  repDelta,
  emphasis,
}: {
  label: string;
  bond: string;
  reputation: number;
  bondDelta?: string;
  repDelta?: number;
  emphasis?: "loss" | "gain";
}) {
  const deltaColor = emphasis === "loss" ? "text-state-slashed" : "text-state-clean";
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-ink-500">{label}</p>
      <p className="mt-1 truncate text-base font-semibold tabular-nums text-ink-900">
        {formatPrax(bond)}
        <span className="ml-1 text-[10px] font-normal text-ink-500">PRAX</span>
      </p>
      {bondDelta && <p className={`text-[11px] tabular-nums ${deltaColor}`}>{bondDelta}</p>}
      <p className="mt-1.5 text-[11px] text-ink-500">
        reputation <span className="font-medium tabular-nums text-ink-800">{reputation}</span>
        {repDelta !== undefined && repDelta !== 0 && (
          <span className={`ml-1 tabular-nums ${deltaColor}`}>
            ({repDelta > 0 ? "+" : "−"}
            {Math.abs(repDelta)})
          </span>
        )}
      </p>
    </div>
  );
}

function TxLink({ label, hash }: { label: string; hash: string | null }) {
  const url = txUrl(hash);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent-600 underline-offset-2 hover:underline"
    >
      {label} ↗
    </a>
  );
}
