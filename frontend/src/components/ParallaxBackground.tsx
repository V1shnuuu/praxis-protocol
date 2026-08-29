"use client";

import { useRef } from "react";
import { useParallax } from "@/lib/parallax";

/**
 * Layered depth behind the whole page, tuned for a bright ground: soft colour
 * blooms, a faint rule grid and drifting hash marks, each travelling at its own
 * rate. Everything stays low-contrast so type on top never has to fight it.
 *
 * Purely decorative — aria-hidden, and inert under prefers-reduced-motion.
 */
export function ParallaxBackground() {
  const wash = useRef<HTMLDivElement>(null);
  const bloom = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const marks = useRef<HTMLDivElement>(null);

  useParallax([
    { ref: wash, speed: 0.02, pointer: 5 },
    { ref: bloom, speed: 0.08, pointer: 18, zoom: 0.00004 },
    { ref: grid, speed: 0.2, pointer: 7 },
    { ref: marks, speed: 0.36, pointer: 26 },
  ]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {/* Warm base wash — barely moves, keeps the paper from reading as flat white. */}
      <div
        ref={wash}
        className="absolute -inset-[10%] will-change-transform"
        style={{
          background:
            "radial-gradient(120rem 70rem at 50% -25%, rgba(47,107,255,0.07), transparent 62%)," +
            "radial-gradient(70rem 50rem at 100% 8%, rgba(255,183,120,0.07), transparent 58%)",
        }}
      />

      {/* Soft colour blooms. Large, low opacity, heavily blurred. */}
      <div ref={bloom} className="absolute -inset-[18%] will-change-transform">
        <div
          className="absolute left-[4%] top-[8%] h-[36rem] w-[36rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(47,107,255,0.13), transparent 66%)" }}
        />
        <div
          className="absolute right-[2%] top-[30%] h-[30rem] w-[30rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(167,139,250,0.12), transparent 66%)" }}
        />
        <div
          className="absolute left-[34%] top-[72%] h-[34rem] w-[34rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(110,231,199,0.12), transparent 66%)" }}
        />
      </div>

      {/* Faint rule grid — the ledger texture, barely there. */}
      <div
        ref={grid}
        className="absolute -inset-[20%] will-change-transform"
        style={{
          backgroundImage:
            "linear-gradient(rgba(20,22,26,0.045) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(20,22,26,0.045) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(75rem 55rem at 50% 20%, black, transparent 76%)",
          WebkitMaskImage: "radial-gradient(75rem 55rem at 50% 20%, black, transparent 76%)",
        }}
      />

      {/* Drifting hash marks — the fastest layer, attestations in flight. */}
      <div ref={marks} className="absolute -inset-[25%] will-change-transform">
        {HASH_MARKS.map((mark) => (
          <span
            key={mark.id}
            className="absolute font-mono text-[10px] tracking-tight text-ink-900"
            style={{ left: mark.left, top: mark.top, opacity: mark.opacity }}
          >
            {mark.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Fixed, hand-picked positions rather than Math.random(), so the server and
 * client render identical markup and the layout never shifts between reloads.
 */
const HASH_MARKS = [
  { id: 1, left: "6%", top: "18%", opacity: 0.1, text: "0x4f2a…9c1b" },
  { id: 2, left: "78%", top: "9%", opacity: 0.08, text: "0xbe07…31da" },
  { id: 3, left: "24%", top: "44%", opacity: 0.07, text: "0x91cc…7e42" },
  { id: 4, left: "88%", top: "52%", opacity: 0.09, text: "0x0d38…a5f0" },
  { id: 5, left: "12%", top: "68%", opacity: 0.07, text: "0x77ba…2e93" },
  { id: 6, left: "58%", top: "82%", opacity: 0.08, text: "0xc4e1…60ab" },
  { id: 7, left: "40%", top: "26%", opacity: 0.06, text: "0x2a95…d7c8" },
  { id: 8, left: "68%", top: "66%", opacity: 0.07, text: "0xf103…84be" },
];
