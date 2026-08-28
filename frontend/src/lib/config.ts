/** Public runtime config, read from NEXT_PUBLIC_* at build time. */

const raw = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL?.trim() || "",
  pollIntervalMs: Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS || 4000),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL?.trim() || "https://rpc-amoy.polygon.technology",
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID || 80002),
  explorerUrl: process.env.NEXT_PUBLIC_EXPLORER_URL?.trim() || "https://amoy.polygonscan.com",
};

export const config = {
  ...raw,
  /** With no API URL configured the dashboard drives itself from the demo simulation. */
  isDemoMode: raw.apiUrl.length === 0,
  pollIntervalMs: Number.isFinite(raw.pollIntervalMs) ? Math.max(1000, raw.pollIntervalMs) : 4000,
};

export function txUrl(hash: string | null | undefined): string | null {
  if (!hash || !config.explorerUrl) return null;
  return `${config.explorerUrl}/tx/${hash}`;
}

export function addressUrl(address: string | null | undefined): string | null {
  if (!address || !config.explorerUrl) return null;
  return `${config.explorerUrl}/address/${address}`;
}
