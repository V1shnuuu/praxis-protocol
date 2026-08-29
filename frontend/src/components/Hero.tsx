"use client";

import { useRef } from "react";
import { useParallax } from "@/lib/parallax";

/**
 * Landing panel above the dashboard: what the protocol claims, and why the
 * numbers below matter. Its own content parallaxes — the headline drifts up and
 * fades as the dashboard rises to meet it.
 */
export function Hero() {
  const headline = useRef<HTMLDivElement>(null);
  const pillars = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLDivElement>(null);

  useParallax([
    { ref: headline, speed: 0.28, pointer: 8 },
    { ref: pillars, speed: 0.14, pointer: 4 },
    { ref: cue, speed: 0.5 },
  ]);

  return (
    <section className="relative mx-auto flex min-h-[86vh] w-full max-w-[1600px] flex-col justify-center px-4 pb-10 pt-16 sm:px-6 sm:pt-20">
      <div ref={headline} className="will-change-transform">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/8 px-3 py-1 text-[11px] font-medium tracking-wide text-cyan-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" />
          </span>
          Polygon Amoy · agent accountability layer
        </p>

        <h1 className="max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight text-ink-50 sm:text-6xl lg:text-7xl">
          Autonomous agents that{" "}
          <span className="bg-gradient-to-r from-cyan-400 via-cyan-500 to-cyan-600 bg-clip-text text-transparent">
            stake their word
          </span>
          .
        </h1>

        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink-200 sm:text-base">
          An agent registers a policy in plain language and bonds capital against keeping it. Every
          decision it makes is hashed and committed on-chain before it acts. Break the policy, and
          anyone can prove it — and take the bond.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href="#dashboard"
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2.5 text-sm font-medium text-navy-950 shadow-glow transition-colors hover:bg-cyan-400"
          >
            Watch an agent get slashed
            <span aria-hidden>↓</span>
          </a>
          <a
            href="https://github.com/V1shnuuu/praxis-protocol"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 rounded-lg border border-navy-600 bg-navy-800/60 px-5 py-2.5 text-sm font-medium text-ink-200 transition-colors hover:border-navy-600 hover:text-ink-50"
          >
            Read the contracts
            <span aria-hidden>↗</span>
          </a>
        </div>
      </div>

      {/* The three-step claim, restated as the mechanism. */}
      <div ref={pillars} className="mt-14 will-change-transform sm:mt-20">
        <ol className="grid gap-3 sm:grid-cols-3 sm:gap-4">
          {PILLARS.map((pillar, index) => (
            <li
              key={pillar.title}
              className="panel group relative overflow-hidden px-4 py-4 transition-colors hover:border-cyan-500/30"
            >
              <span className="absolute right-3 top-3 font-mono text-[10px] text-ink-600">
                0{index + 1}
              </span>
              <h2 className="text-sm font-semibold text-ink-50">{pillar.title}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{pillar.body}</p>
              <span
                className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </li>
          ))}
        </ol>
      </div>

      <div ref={cue} className="mt-12 flex justify-center will-change-transform sm:mt-16">
        <span className="flex flex-col items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-ink-600">
          Live protocol
          <span className="h-8 w-px bg-gradient-to-b from-cyan-500/60 to-transparent" aria-hidden />
        </span>
      </div>
    </section>
  );
}

const PILLARS = [
  {
    title: "Declare",
    body: "The agent registers a plain-language policy and posts a bond it forfeits if it breaks it.",
  },
  {
    title: "Commit",
    body: "Each decision's full reasoning trail is hashed on-chain before the action lands. Nothing can be rewritten after the fact.",
  },
  {
    title: "Slash",
    body: "Anyone can stake a fee to challenge an action. Upheld, the bond is cut and the challenger paid; rejected, the agent keeps the fee.",
  },
];
