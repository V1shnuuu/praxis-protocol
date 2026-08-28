"use client";

import type { ReputationPoint } from "@/lib/types";
import { REPUTATION } from "@/lib/reputation";

/**
 * Reputation is a headline number; the sparkline is supporting context for how
 * it got there. Single series, so no legend — the label names it. Status hue
 * always travels with a text tier badge, never colour alone.
 */

const TONE = {
  up: { stroke: "#34D399", fill: "rgba(52,211,153,0.14)" },
  down: { stroke: "#FB7185", fill: "rgba(251,113,133,0.14)" },
  flat: { stroke: "#12C6E0", fill: "rgba(18,198,224,0.12)" },
} as const;

export type TrendDirection = keyof typeof TONE;

export function trendOf(history: ReputationPoint[]): { direction: TrendDirection; delta: number } {
  if (history.length < 2) return { direction: "flat", delta: 0 };
  const first = history[0]!.score;
  const last = history[history.length - 1]!.score;
  const delta = last - first;
  return { direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat", delta };
}

export function Sparkline({
  history,
  direction,
  width = 96,
  height = 30,
  className = "",
}: {
  history: ReputationPoint[];
  direction: TrendDirection;
  width?: number;
  height?: number;
  className?: string;
}) {
  const tone = TONE[direction];
  const points = history.length >= 2 ? history : null;

  if (!points) {
    // A flat rule reads honestly as "not enough history yet".
    return (
      <svg width={width} height={height} className={className} aria-hidden>
        <line
          x1={2}
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke="#25395C"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="3 4"
        />
      </svg>
    );
  }

  // Scale against the full 0..1000 domain, clamped to the observed band, so a
  // 5-point wobble does not render as a cliff.
  const scores = points.map((p) => p.score);
  const rawMin = Math.min(...scores);
  const rawMax = Math.max(...scores);
  const pad = Math.max(30, (rawMax - rawMin) * 0.25);
  const min = Math.max(0, rawMin - pad);
  const max = Math.min(REPUTATION.MAX_SCORE, rawMax + pad);
  const span = max - min || 1;

  const inset = 3;
  const x = (i: number) => inset + (i / (points.length - 1)) * (width - inset * 2);
  const y = (score: number) => height - inset - ((score - min) / span) * (height - inset * 2);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.score).toFixed(2)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(2)},${height} L${x(0).toFixed(2)},${height} Z`;
  const lastX = x(points.length - 1);
  const lastY = y(points[points.length - 1]!.score);
  const gradientId = `spark-${direction}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Reputation trend, ${direction === "flat" ? "steady" : direction}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone.fill} />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={tone.stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* Only the current value gets a marker — never a dot on every point. */}
      <circle cx={lastX} cy={lastY} r={3} fill={tone.stroke} stroke="#0A1122" strokeWidth={2} />
    </svg>
  );
}

export function ReputationTrend({ history, score }: { history: ReputationPoint[]; score: number }) {
  const { direction, delta } = trendOf(history);
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "—";
  const deltaColor =
    direction === "up" ? "text-state-clean" : direction === "down" ? "text-state-slashed" : "text-ink-400";

  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold tabular-nums leading-none text-ink-50">{score}</span>
          <span className="text-xs text-ink-400">/ {REPUTATION.MAX_SCORE}</span>
        </div>
        <div className={`mt-1 flex items-center gap-1 text-[11px] tabular-nums ${deltaColor}`}>
          <span aria-hidden>{arrow}</span>
          <span>
            {delta === 0 ? "steady" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} this session`}
          </span>
        </div>
      </div>
      <Sparkline history={history} direction={direction} className="shrink-0" />
    </div>
  );
}
