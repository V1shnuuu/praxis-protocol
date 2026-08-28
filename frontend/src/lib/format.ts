/** Presentation helpers. Kept pure so components stay declarative. */

export function shortAddress(address: string | null | undefined, size = 4): string {
  if (!address) return "—";
  if (address.length <= size * 2 + 2) return address;
  return `${address.slice(0, size + 2)}…${address.slice(-size)}`;
}

export function shortHash(hash: string | null | undefined): string {
  return shortAddress(hash, 6);
}

/** "8,000" from "8000". Falls back to the raw string if it is not numeric. */
export function formatPrax(amount: string | null | undefined): string {
  if (amount == null) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatDelta(before: string, after: string): string {
  const diff = Number(after) - Number(before);
  if (!Number.isFinite(diff) || diff === 0) return "no change";
  const sign = diff > 0 ? "+" : "−";
  return `${sign}${Math.abs(diff).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** "12s ago", "4m ago", "2h ago", then an absolute date. */
export function timeAgo(unixSeconds: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor(now / 1000 - unixSeconds));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function formatClock(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Remaining seconds in a challenge window, or 0 once it has closed. */
export function secondsRemaining(openedAt: number, windowSeconds: number, now = Date.now()): number {
  return Math.max(0, Math.ceil(openedAt + windowSeconds - now / 1000));
}

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
