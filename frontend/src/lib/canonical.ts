/**
 * Canonical serialisation of a decision trail.
 *
 * The trail hash is a commitment shared by three parties — the Python
 * orchestrator that writes it, the Solidity contract that stores it, and this
 * dashboard that re-checks it — so the bytes being hashed cannot depend on
 * incidental key order. Every producer must serialise through this exact rule:
 *
 *   - object keys sorted lexicographically, recursively
 *   - no insignificant whitespace
 *   - arrays keep their order
 *
 * In Python the equivalent is:
 *   json.dumps(body, sort_keys=True, separators=(",", ":"))
 *
 * The hash is then keccak256 over the UTF-8 bytes of that string.
 */
import { keccak256, toHex } from "viem";

export type TrailBody = Record<string, unknown>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  return value;
}

/** Deterministic JSON for a trail body. */
export function canonicalTrailJson(body: TrailBody): string {
  return JSON.stringify(canonicalize(body));
}

/** keccak256 over the canonical JSON — the value committed on-chain. */
export function hashTrail(body: TrailBody): `0x${string}` {
  return keccak256(toHex(canonicalTrailJson(body)));
}
