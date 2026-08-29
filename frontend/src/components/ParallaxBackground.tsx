"use client";

import { useRef } from "react";
import { useParallax } from "@/lib/parallax";

/**
 * Layered depth behind the whole page. Fixed to the viewport and pointer-events
 * free, so it never interferes with the dashboard; each layer travels at its own
 * rate to give the scroll a sense of depth.
 *
 * Purely decorative — aria-hidden, and inert under prefers-reduced-motion.
 */
export function ParallaxBackground() {
  const glow = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const marks = useRef<HTMLDivElement>(null);
  const haze = useRef<HTMLDivElement>(null);

  useParallax([
    { ref: haze, speed: 0.02, pointer: 6 },
    { ref: glow, speed: 0.08, pointer: 16, zoom: 0.00004 },
    { ref: grid, speed: 0.18, pointer: 8 },
    { ref: marks, speed: 0.34, pointer: 26 },
  ]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {/* Base wash — barely moves, anchors the palette. */}
      <div
        ref={haze}
        className="absolute -inset-[10%] will-change-transform"
        style={{
          background:
            "radial-gradient(120rem 70rem at 50% -20%, rgba(18,198,224,0.10), transparent 60%)," +
            "radial-gradient(80rem 50rem at 90% 10%, rgba(56,224,245,0.05), transparent 55%)",
        }}
      />

      {/* Cyan glow orbs. */}
      <div ref={glow} className="absolute -inset-[15%] will-change-transform">
        <div
          className="absolute left-[8%] top-[12%] h-[34rem] w-[34rem] rounded-full opacity-70 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(18,198,224,0.16), transparent 65%)" }}
        />
        <div
          className="absolute right-[4%] top-[38%] h-[26rem] w-[26rem] rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(56,224,245,0.12), transparent 65%)" }}
        />
        <div
          className="absolute left-[38%] top-[76%] h-[30rem] w-[30rem] rounded-full opacity-50 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(10,163,188,0.14), transparent 65%)" }}
        />
      </div>

      {/* Technical grid — the "ledger" texture. */}
      <div
        ref={grid}
        className="absolute -inset-[20%] opacity-[0.55] will-change-transform"
        style={{
          backgroundImage:
            "linear-gradient(rgba(37,57,92,0.30) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(37,57,92,0.30) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(80rem 60rem at 50% 25%, black, transparent 78%)",
          WebkitMaskImage: "radial-gradient(80rem 60rem at 50% 25%, black, transparent 78%)",
        }}
      />

      {/* Drifting hash marks — the fastest layer, reads as attestations in flight. */}
      <div ref={marks} className="absolute -inset-[25%] will-change-transform">
        {HASH_MARKS.map((mark) => (
          <span
            key={mark.id}
            className="absolute font-mono text-[10px] tracking-tight text-cyan-400"
            style={{ left: mark.left, top: mark.top, opacity: mark.opacity }}
          >
            {mark.text}
          </span>
        ))}
      </div>

      {/* Vignette keeps the centre legible. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(100rem 70rem at 50% 40%, transparent 40%, rgba(5,9,18,0.55) 100%)",
        }}
      />
    </div>
  );
}

/**
 * Fixed, hand-picked positions rather than Math.random(), so the server and
 * client render identical markup and the layout never shifts between reloads.
 */
const HASH_MARKS = [
  { id: 1, left: "6%", top: "18%", opacity: 0.16, text: "0x4f2a…9c1b" },
  { id: 2, left: "78%", top: "9%", opacity: 0.12, text: "0xbe07…31da" },
  { id: 3, left: "24%", top: "44%", opacity: 0.1, text: "0x91cc…7e42" },
  { id: 4, left: "88%", top: "52%", opacity: 0.14, text: "0x0d38…a5f0" },
  { id: 5, left: "12%", top: "68%", opacity: 0.11, text: "0x77ba…2e93" },
  { id: 6, left: "58%", top: "82%", opacity: 0.13, text: "0xc4e1…60ab" },
  { id: 7, left: "40%", top: "26%", opacity: 0.09, text: "0x2a95…d7c8" },
  { id: 8, left: "68%", top: "66%", opacity: 0.1, text: "0xf103…84be" },
];
