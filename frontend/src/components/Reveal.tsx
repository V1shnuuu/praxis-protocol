"use client";

import { useRef, type ReactNode } from "react";
import { useReveal } from "@/lib/parallax";

/**
 * Fades and lifts its children in the first time they scroll into view.
 * Renders visible immediately under prefers-reduced-motion.
 */
export function Reveal({
  children,
  delayMs = 0,
  className = "",
}: {
  children: ReactNode;
  delayMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, delayMs);
  return (
    <div ref={ref} className={`reveal ${className}`}>
      {children}
    </div>
  );
}
