"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { SystemStatus } from "@/lib/types";
import { Badge, Button, Mono } from "@/components/ui/primitives";
import { config } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import {
  getChainId,
  getInjectedProvider,
  requestAccounts,
  switchToConfiguredChain,
} from "@/lib/wallet";

/**
 * Read-only wallet connect. No signatures, no transactions — connecting only
 * proves the dashboard and the judge's wallet are looking at the same chain.
 */
export function WalletConnect({ status }: { status: SystemStatus | null }) {
  // window.ethereum is an external mutable source, and it does not exist during
  // SSR — useSyncExternalStore reads it without a hydration mismatch.
  const provider = useSyncExternalStore(subscribeToInjection, getInjectedProvider, () => null);

  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!provider?.on || !provider.removeListener) return;
    const onAccounts = (...args: never[]) => {
      const accounts = args[0] as unknown as string[] | undefined;
      setAccount(accounts?.[0] ?? null);
    };
    const onChain = (...args: never[]) => {
      const hex = args[0] as unknown as string | undefined;
      setChainId(hex ? Number.parseInt(hex, 16) : null);
    };
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const accounts = await requestAccounts(provider);
      setAccount(accounts[0] ?? null);
      setChainId(await getChainId(provider));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Wallet connection failed";
      // 4001 = user rejected; not worth showing as an error.
      setError((cause as { code?: number })?.code === 4001 ? null : message);
    } finally {
      setBusy(false);
    }
  }, [provider]);

  const switchChain = useCallback(async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      await switchToConfiguredChain(provider);
      setChainId(await getChainId(provider));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch network");
    } finally {
      setBusy(false);
    }
  }, [provider]);

  const expectedChain = status?.chainId && status.chainId > 0 ? status.chainId : config.chainId;
  const wrongChain = account !== null && chainId !== null && chainId !== expectedChain;

  if (!provider) {
    return (
      <Badge tone="muted" className="whitespace-nowrap">
        No wallet detected
      </Badge>
    );
  }

  if (!account) {
    return (
      <div className="flex items-center gap-2">
        {error && <span className="hidden text-[11px] text-state-slashed sm:inline">{error}</span>}
        <Button size="sm" variant="ghost" onClick={connect} disabled={busy}>
          {busy ? "Connecting…" : "Connect wallet"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {wrongChain ? (
        <Button size="sm" variant="ghost" onClick={switchChain} disabled={busy}>
          Switch to chain {expectedChain}
        </Button>
      ) : (
        <Badge tone="cyan" className="whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden />
          <Mono className="text-accent-600">{shortAddress(account)}</Mono>
        </Badge>
      )}
      <span className="hidden text-[10px] text-ink-400 lg:inline">read-only</span>
    </div>
  );
}

/**
 * Wallets inject before hydration in practice, but EIP-6963 announcements can
 * arrive late; re-read when one does.
 */
function subscribeToInjection(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("eip6963:announceProvider", onChange);
  return () => window.removeEventListener("eip6963:announceProvider", onChange);
}
