"use client";

import { useRef } from "react";
import { useParallax } from "@/lib/parallax";

/**
 * Landing panel above the dashboard. Bright and spare: one large statement,
 * one line of explanation, two actions, and the mechanism as three hairline
 * columns rather than boxes. Content parallaxes gently against the background.
 */
export function Hero() {
  const headline = useRef<HTMLDivElement>(null);
  const pillars = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLDivElement>(null);

  useParallax([
    // Speeds must decrease down the page: a lower element that travelled up
    // faster than the one above it would slide into it as you scroll.
    { ref: headline, speed: 0.26, pointer: 7 },
    { ref: pillars, speed: 0.12, pointer: 3 },
    { ref: cue, speed: 0.05 },
  ]);

  return (
    <section className="relative mx-auto flex min-h-[88vh] w-full max-w-6xl flex-col justify-center px-6 pb-16 pt-20 sm:pt-24">
      <div ref={headline} className="will-change-transform">
        <p className="mb-7 inline-flex items-center gap-2 text-[11px] font-medium tracking-[0.06em] text-ink-500">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-500 opacity-50" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-500" />
          </span>
          POLYGON AMOY · AGENT ACCOUNTABILITY LAYER
        </p>

        <h1 className="max-w-3xl text-[2.75rem] font-semibold leading-[1.02] tracking-tighter text-ink-900 sm:text-6xl lg:text-[4.5rem]">
          Autonomous agents
          <br />
          that <span className="text-accent-500">stake their word</span>.
        </h1>

        <p className="mt-8 max-w-xl text-base leading-relaxed text-ink-600">
          An agent declares a policy in plain language and bonds capital against keeping it. Every
          decision is hashed on-chain before it acts. Break the policy, and anyone can prove it —
          and take the bond.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <a
            href="#dashboard"
            className="group inline-flex items-center gap-2 rounded-full bg-ink-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-ink-800"
          >
            Watch an agent get slashed
            <span className="transition-transform group-hover:translate-y-0.5" aria-hidden>
              ↓
            </span>
          </a>
          <a
            href="https://github.com/V1shnuuu/praxis-protocol"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
          >
            Read the contracts
            <span aria-hidden>↗</span>
          </a>
        </div>
      </div>

      {/* The mechanism, as three columns divided by hairlines rather than cards. */}
      <div ref={pillars} className="mt-16 will-change-transform sm:mt-24">
        <ol className="grid border-t border-line-300 sm:grid-cols-3">
          {PILLARS.map((pillar, index) => (
            <li
              key={pillar.title}
              className="border-b border-line-300 py-6 pr-8 sm:border-b-0 sm:border-r sm:last:border-r-0 sm:pl-8 sm:first:pl-0"
            >
              <span className="font-mono text-[10px] text-ink-400">0{index + 1}</span>
              <h2 className="mt-2 text-sm font-semibold text-ink-900">{pillar.title}</h2>
              <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-ink-500">{pillar.body}</p>
            </li>
          ))}
        </ol>
      </div>

      <div ref={cue} className="mt-16 flex justify-center will-change-transform">
        <span className="flex flex-col items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-ink-400">
          Live protocol
          <span className="h-10 w-px bg-gradient-to-b from-line-400 to-transparent" aria-hidden />
        </span>
      </div>
    </section>
  );
}

const PILLARS = [
  {
    title: "Declare",
    body: "A plain-language policy, registered on-chain, backed by a bond the agent forfeits if it breaks it.",
  },
  {
    title: "Commit",
    body: "Each decision's full reasoning trail is hashed before the action lands. Nothing can be rewritten after the fact.",
  },
  {
    title: "Slash",
    body: "Anyone can stake a fee to challenge an action. Upheld, the bond is cut and the challenger paid; rejected, the agent keeps the fee.",
  },
];
