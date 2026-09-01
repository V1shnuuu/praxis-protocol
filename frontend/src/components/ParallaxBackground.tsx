"use client";

import { useRef } from "react";
import { useParallax } from "@/lib/parallax";

/**
 * The aurora field behind the whole page.
 *
 * This is not only decoration — the glass panels are `backdrop-blur` over a
 * 5.5% white fill, and a blur of a flat colour is that same flat colour. The
 * panels only read as glass because this layer puts real luminance and hue
 * variation underneath them. Five parallax layers plus a vignette and a grain
 * pass, so the blur behind a card changes as you scroll past it.
 *
 * Blooms also drift on their own long, mutually-prime-ish CSS animations, so
 * the backdrop keeps moving when the page is still. Everything is composited:
 * transforms and opacity only, no filters animating.
 *
 * Purely decorative — aria-hidden, and inert under prefers-reduced-motion
 * (useParallax pins the layers; the CSS animations are cancelled by the
 * reduced-motion block in globals.css).
 */
export function ParallaxBackground() {
  const wash = useRef<HTMLDivElement>(null);
  const blooms = useRef<HTMLDivElement>(null);
  const stars = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const marks = useRef<HTMLDivElement>(null);

  useParallax([
    { ref: wash, speed: 0.015, pointer: 6 },
    { ref: blooms, speed: 0.07, pointer: 22, zoom: 0.00005 },
    { ref: stars, speed: 0.14, pointer: 12 },
    { ref: grid, speed: 0.22, pointer: 8 },
    { ref: marks, speed: 0.4, pointer: 30 },
  ]);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-void-900" aria-hidden>
      {/* Base wash. Barely moves — it establishes that the ground is lit from
          above and to the right, which every other layer then sits inside. */}
      <div
        ref={wash}
        className="absolute -inset-[10%] will-change-transform"
        style={{
          background:
            "radial-gradient(120rem 70rem at 50% -18%, rgba(124,158,255,0.30), transparent 62%)," +
            "radial-gradient(80rem 55rem at 100% 8%, rgba(168,123,255,0.22), transparent 60%)," +
            "radial-gradient(75rem 55rem at 0% 62%, rgba(62,224,161,0.13), transparent 62%)," +
            "radial-gradient(70rem 50rem at 92% 88%, rgba(255,180,84,0.10), transparent 62%)",
        }}
      />

      {/* The aurora proper: large, heavily blurred colour bodies on slow,
          independent drifts. Composited normally rather than screen-blended —
          this container carries a transform, which opens a stacking context, so
          a blend mode here would only ever resolve against its transparent
          siblings and never against the wash. */}
      <div ref={blooms} className="absolute -inset-[20%] will-change-transform">
        <div
          className="animate-drift-slow absolute left-[2%] top-[4%] h-[42rem] w-[42rem] rounded-full opacity-90 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(124,158,255,0.60), transparent 65%)" }}
        />
        <div
          className="animate-drift-slower absolute right-[-4%] top-[24%] h-[38rem] w-[38rem] rounded-full opacity-80 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(168,123,255,0.54), transparent 65%)" }}
        />
        <div
          className="animate-drift-slowest absolute left-[28%] top-[64%] h-[44rem] w-[44rem] rounded-full opacity-75 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(62,224,161,0.40), transparent 66%)" }}
        />
        <div
          className="animate-drift-slower absolute right-[18%] top-[86%] h-[34rem] w-[34rem] rounded-full opacity-65 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(255,180,84,0.32), transparent 66%)" }}
        />
      </div>

      {/* Starfield. Fixed positions rather than Math.random() so server and
          client render identical markup and nothing shifts between reloads. */}
      <div ref={stars} className="absolute -inset-[15%] will-change-transform">
        {STARS.map((star) => (
          <span
            key={star.id}
            className="animate-twinkle absolute rounded-full bg-white"
            style={{
              left: star.left,
              top: star.top,
              width: star.size,
              height: star.size,
              opacity: star.opacity,
              animationDelay: star.delay,
            }}
          />
        ))}
      </div>

      {/* The ledger grid — the texture that says "this is a record". Masked to
          a soft ellipse so it never reaches the edges as a hard cut. */}
      <div
        ref={grid}
        className="absolute -inset-[20%] will-change-transform"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px)",
          backgroundSize: "76px 76px",
          maskImage: "radial-gradient(80rem 60rem at 50% 24%, black, transparent 74%)",
          WebkitMaskImage: "radial-gradient(80rem 60rem at 50% 24%, black, transparent 74%)",
        }}
      />

      {/* Drifting hash marks — the fastest layer, attestations in flight. */}
      <div ref={marks} className="absolute -inset-[25%] will-change-transform">
        {HASH_MARKS.map((mark) => (
          <span
            key={mark.id}
            className="absolute font-mono text-[10px] tracking-tight text-accent-400"
            style={{ left: mark.left, top: mark.top, opacity: mark.opacity }}
          >
            {mark.text}
          </span>
        ))}
      </div>

      {/* Vignette, painted last and pinned: pulls the corners down so the glass
          panels always have a darker frame to sit against. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(125% 95% at 50% 28%, transparent 48%, rgba(5,6,13,0.32) 84%, rgba(5,6,13,0.62) 100%)",
        }}
      />

      {/* Fine grain. Breaks up the banding that large, low-contrast gradients
          produce on 8-bit displays — an SVG turbulence tile so it costs one
          data URI rather than an image request. */}
      <div
        className="absolute inset-0 opacity-[0.18] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}

const STARS = [
  { id: 1, left: "8%", top: "12%", size: "2px", opacity: 0.5, delay: "0s" },
  { id: 2, left: "22%", top: "28%", size: "1px", opacity: 0.35, delay: "1.2s" },
  { id: 3, left: "37%", top: "8%", size: "2px", opacity: 0.4, delay: "2.4s" },
  { id: 4, left: "54%", top: "18%", size: "1px", opacity: 0.3, delay: "0.6s" },
  { id: 5, left: "71%", top: "6%", size: "2px", opacity: 0.45, delay: "3.1s" },
  { id: 6, left: "86%", top: "22%", size: "1px", opacity: 0.32, delay: "1.8s" },
  { id: 7, left: "14%", top: "46%", size: "1px", opacity: 0.28, delay: "2.9s" },
  { id: 8, left: "31%", top: "58%", size: "2px", opacity: 0.38, delay: "0.4s" },
  { id: 9, left: "49%", top: "41%", size: "1px", opacity: 0.26, delay: "3.6s" },
  { id: 10, left: "66%", top: "52%", size: "2px", opacity: 0.42, delay: "1.5s" },
  { id: 11, left: "82%", top: "44%", size: "1px", opacity: 0.3, delay: "2.1s" },
  { id: 12, left: "94%", top: "62%", size: "2px", opacity: 0.36, delay: "0.9s" },
  { id: 13, left: "6%", top: "72%", size: "1px", opacity: 0.29, delay: "4.2s" },
  { id: 14, left: "27%", top: "84%", size: "2px", opacity: 0.4, delay: "1.1s" },
  { id: 15, left: "44%", top: "76%", size: "1px", opacity: 0.25, delay: "3.3s" },
  { id: 16, left: "61%", top: "88%", size: "2px", opacity: 0.34, delay: "2.6s" },
  { id: 17, left: "77%", top: "78%", size: "1px", opacity: 0.31, delay: "0.2s" },
  { id: 18, left: "90%", top: "92%", size: "2px", opacity: 0.37, delay: "4.7s" },
];

const HASH_MARKS = [
  { id: 1, left: "6%", top: "18%", opacity: 0.22, text: "0x4f2a…9c1b" },
  { id: 2, left: "78%", top: "9%", opacity: 0.18, text: "0xbe07…31da" },
  { id: 3, left: "24%", top: "44%", opacity: 0.15, text: "0x91cc…7e42" },
  { id: 4, left: "88%", top: "52%", opacity: 0.2, text: "0x0d38…a5f0" },
  { id: 5, left: "12%", top: "68%", opacity: 0.16, text: "0x77ba…2e93" },
  { id: 6, left: "58%", top: "82%", opacity: 0.18, text: "0xc4e1…60ab" },
  { id: 7, left: "40%", top: "26%", opacity: 0.13, text: "0x2a95…d7c8" },
  { id: 8, left: "68%", top: "66%", opacity: 0.16, text: "0xf103…84be" },
];
