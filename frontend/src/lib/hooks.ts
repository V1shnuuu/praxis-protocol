"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, startDemoIfNeeded } from "./api";
import { config } from "./config";

export interface Resource<T> {
  data: T | null;
  error: string | null;
  /** True only on the first load, so refreshes do not flash skeletons. */
  loading: boolean;
  refresh: () => void;
}

/**
 * Polls a fetcher on an interval and re-runs it whenever the API layer signals
 * a change. In demo mode the store notifies synchronously, so the UI updates
 * the instant the rogue button is pressed rather than on the next poll.
 */
export function usePolled<T>(fetcher: () => Promise<T>, intervalMs = config.pollIntervalMs): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetcherRef = useRef(fetcher);
  const mounted = useRef(true);

  // Keep the latest fetcher without making it an effect dependency, so a new
  // closure does not tear down and re-create the poll interval.
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const run = useCallback(async () => {
    try {
      const next = await fetcherRef.current();
      if (!mounted.current) return;
      setData(next);
      setError(null);
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    startDemoIfNeeded();
    void run();

    const timer = setInterval(() => void run(), intervalMs);
    const unsubscribe = api.subscribe(() => void run());

    return () => {
      mounted.current = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [run, intervalMs]);

  return { data, error, loading, refresh: run };
}

/** Re-renders once a second, so relative timestamps and countdowns stay live. */
export function useTicker(intervalMs = 1000): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return tick;
}

/** Closes an overlay on Escape and locks background scroll while it is open. */
export function useDismissable(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);
}
