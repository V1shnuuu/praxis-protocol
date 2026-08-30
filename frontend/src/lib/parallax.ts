"use client";

import { useEffect, useRef } from "react";

/**
 * Scroll- and pointer-driven parallax.
 *
 * Every layer is written imperatively from a single rAF loop rather than
 * through React state: a 60fps scroll must not re-render the dashboard. Layers
 * only ever get `transform`, so the work stays on the compositor.
 *
 * Honours prefers-reduced-motion by leaving every layer at its resting position.
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
