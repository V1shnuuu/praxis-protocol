"use client";

/**
 * Read-only wallet connect via the injected EIP-1193 provider.
 *
 * Deliberately minimal: the dashboard never asks for a signature or sends a
 * transaction. Connecting exists so a judge can point their own wallet at the
 * same chain and confirm the contracts and balances are real, not mocked.
 */
import { createPublicClient, custom, formatUnits, http, type Address, type PublicClient } from "viem";
import { config } from "./config";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

/** A read-only client against the configured RPC, independent of any wallet. */
export function createReadClient(): PublicClient {
  return createPublicClient({ transport: http(config.rpcUrl) });
}

export async function requestAccounts(provider: Eip1193Provider): Promise<Address[]> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  return accounts ?? [];
}

export async function getChainId(provider: Eip1193Provider): Promise<number> {
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  return Number.parseInt(hex, 16);
}

/** Prompts the wallet to switch to the configured chain; adds it if unknown. */
export async function switchToConfiguredChain(provider: Eip1193Provider): Promise<void> {
  const hexChainId = `0x${config.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId }] });
  } catch (error) {
    // 4902 = chain not present in the wallet.
    const code = (error as { code?: number })?.code;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexChainId,
          chainName: "Polygon Amoy",
          nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
          rpcUrls: [config.rpcUrl],
          blockExplorerUrls: [config.explorerUrl],
        },
      ],
    });
  }
}

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Reads a PRAX balance, so a connected judge sees a real on-chain number. */
export async function readTokenBalance(
  client: PublicClient,
  token: Address,
  account: Address
): Promise<string> {
  const raw = await client.readContract({
    address: token,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [account],
  });
  return formatUnits(raw, 18);
}

export function providerTransport(provider: Eip1193Provider) {
  return custom(provider);
}
