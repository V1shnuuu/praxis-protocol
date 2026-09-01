"use client";

import { useEffect, useRef } from "react";

/**
 * Scroll- and pointer-driven motion primitives.
 *
 * Everything here is written imperatively from a rAF loop rather than through
 * React state: a 60fps scroll must not re-render the dashboard, which is
 * polling four endpoints at the same time. Layers only ever receive
 * `transform` or a custom property that resolves to one, so the work stays on
 * the compositor and never triggers layout.
 *
 * Every hook honours prefers-reduced-motion by leaving its target at rest.
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface ParallaxLayer {
  ref: React.RefObject<HTMLElement | null>;
  /** Fraction of scroll distance the layer travels. 0 = pinned, 1 = scrolls normally. */
  speed: number;
  /** Extra pixels of travel per unit of normalised pointer offset (-1..1). */
  pointer?: number;
  /** Optional scale applied as the page scrolls, e.g. 0.0001 zooms slowly. */
  zoom?: number;
}

/**
 * Drives a set of layers from scroll position and pointer offset.
 * Pointer parallax is skipped on coarse pointers (touch), where there is no
 * hover to drive it and the extra listener would only cost battery.
 */
export function useParallax(layers: ParallaxLayer[]) {
  const layersRef = useRef(layers);

  // Keep the latest layer list without re-arming the rAF loop. Safe to sync in
  // an effect: the loop only reads it from inside a frame, which runs after
  // effects have flushed, and useRef already seeded it with the first value.
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let frame = 0;
    let scrollY = window.scrollY;
    let pointerX = 0;
    let pointerY = 0;
    // Eased pointer target, so the motion trails the cursor instead of snapping.
    let currentX = 0;
    let currentY = 0;
    let running = true;

    const fine = window.matchMedia("(pointer: fine)").matches;

    const onScroll = () => {
      scrollY = window.scrollY;
      schedule();
    };

    const onPointerMove = (event: PointerEvent) => {
      pointerX = (event.clientX / window.innerWidth) * 2 - 1;
      pointerY = (event.clientY / window.innerHeight) * 2 - 1;
      schedule();
    };

    const schedule = () => {
      if (frame || !running) return;
      frame = requestAnimationFrame(tick);
    };

    const tick = () => {
      frame = 0;
      currentX += (pointerX - currentX) * 0.08;
      currentY += (pointerY - currentY) * 0.08;

      for (const layer of layersRef.current) {
        const node = layer.ref.current;
        if (!node) continue;

        const y = -scrollY * layer.speed + (layer.pointer ? currentY * layer.pointer : 0);
        const x = layer.pointer ? currentX * layer.pointer : 0;
        const scale = layer.zoom ? 1 + scrollY * layer.zoom : 1;

        node.style.transform =
          `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)` +
          (scale !== 1 ? ` scale(${scale.toFixed(4)})` : "");
      }

      // Keep easing until the pointer settles, so motion decelerates smoothly.
      if (fine && (Math.abs(pointerX - currentX) > 0.001 || Math.abs(pointerY - currentY) > 0.001)) {
        schedule();
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    if (fine) window.addEventListener("pointermove", onPointerMove, { passive: true });
    schedule();

    return () => {
      running = false;
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);
}

/**
 * Tilts an element towards the pointer while it is hovered, as a `.tilt` card.
 *
 * The rotation is written to CSS custom properties rather than to `transform`
 * directly, so the stylesheet keeps ownership of the transform function order
 * (perspective first, or the rotation reads as a shear) and of the settle
 * transition on leave.
 *
 * Listeners are bound to the element, not the window, so a page with a dozen
 * tilting cards still only tracks the one the pointer is actually over.
 */
export function useTilt<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  { max = 5, lift = -4 }: { max?: number; lift?: number } = {}
) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion()) return;
    // A coarse pointer has no hover state to drive this, and binding it would
    // make the card tilt on tap and stay that way.
    if (!window.matchMedia("(pointer: fine)").matches) return;

    let frame = 0;
    let nextX = 0;
    let nextY = 0;

    const apply = () => {
      frame = 0;
      node.style.setProperty("--tilt-x", `${nextY.toFixed(2)}deg`);
      node.style.setProperty("--tilt-y", `${nextX.toFixed(2)}deg`);
    };

    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // -1..1 from the element's own centre.
      const px = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const py = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      nextX = px * max;
      // Inverted: pointer below centre should tip the near edge towards you.
      nextY = -py * max;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const onEnter = () => {
      node.dataset.tilting = "true";
      node.style.setProperty("--tilt-lift", `${lift}px`);
    };

    const onLeave = () => {
      delete node.dataset.tilting;
      node.style.setProperty("--tilt-x", "0deg");
      node.style.setProperty("--tilt-y", "0deg");
      node.style.setProperty("--tilt-lift", "0px");
    };

    node.addEventListener("pointerenter", onEnter);
    node.addEventListener("pointermove", onMove, { passive: true });
    node.addEventListener("pointerleave", onLeave);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      node.removeEventListener("pointerenter", onEnter);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
    };
  }, [ref, max, lift]);
}

/**
 * Scales an element horizontally to the page's scroll progress, for a reading
 * rail under the header.
 *
 * `scaleX` on a full-width bar rather than an animated `width`, so the browser
 * never re-lays-out the header on scroll. Unlike the other hooks this one still
 * runs under reduced motion: the rail is a position indicator, not decoration,
 * and freezing it at zero would misreport where the reader is.
 */
export function useScrollProgress<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let frame = 0;

    const apply = () => {
      frame = 0;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      // A page shorter than the viewport has no progress to report; showing a
      // full bar there would claim the reader is at the end of nothing.
      const progress = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
      node.style.transform = `scaleX(${progress.toFixed(4)})`;
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [ref]);
}

/**
 * Adds `data-revealed` to an element once it scrolls into view, so CSS can
 * transition it in. One observer per element, disconnected after firing.
 */
export function useReveal<T extends HTMLElement>(ref: React.RefObject<T | null>, delayMs = 0) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      node.dataset.revealed = "true";
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          window.setTimeout(() => {
            node.dataset.revealed = "true";
          }, delayMs);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, delayMs]);
}
