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
 *   json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
 *
 * The hash is then keccak256 over the UTF-8 bytes of that string.
 *
 * ---------------------------------------------------------------------------
 * Why this builds the string by hand instead of calling JSON.stringify on a
 * key-sorted copy: it can't. JavaScript objects always enumerate array-index-like
 * keys first, in ascending numeric order, whatever order they were inserted in.
 * So for a body containing keys like "2" and "10", `JSON.stringify` re-orders
 * them numerically and quietly overrides the sort — while Python sorts them
 * lexicographically ("10" before "2") and hashes different bytes. The dashboard
 * would then report a mismatch on an honest trail.
 *
 * Emitting objects ourselves puts key order under our control. Scalars still go
 * through `JSON.stringify`, so string escaping and number formatting stay
 * exactly as the platform defines them.
 * ---------------------------------------------------------------------------
 */
import { keccak256, toHex } from "viem";

export type TrailBody = Record<string, unknown>;

/** Values JSON.stringify drops from objects and renders as null inside arrays. */
function isOmitted(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

function serialize(value: unknown): string {
  if (value === null) return "null";

  if (typeof value === "number" && !Number.isFinite(value)) {
    // JSON.stringify would emit `null` here and Python raises. Rather than let
    // the two disagree, refuse to hash a body we can't commit to identically.
    throw new Error(`cannot canonicalise non-finite number: ${value}`);
  }

  if (typeof value === "object") {
    const withToJson = value as { toJSON?: () => unknown };
    if (typeof withToJson.toJSON === "function") return serialize(withToJson.toJSON());

    if (Array.isArray(value)) {
      return `[${value.map((item) => (isOmitted(item) ? "null" : serialize(item))).join(",")}]`;
    }

    const source = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      if (isOmitted(child)) continue;
      parts.push(`${JSON.stringify(key)}:${serialize(child)}`);
    }
    return `{${parts.join(",")}}`;
  }

  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error(`value cannot be serialised: ${String(value)}`);
  return encoded;
}

/** Deterministic JSON for a trail body — the exact string that gets hashed. */
export function canonicalTrailJson(body: TrailBody): string {
  return serialize(body);
}

/** keccak256 over the canonical JSON — the value committed on-chain. */
export function hashTrail(body: TrailBody): `0x${string}` {
  return keccak256(toHex(canonicalTrailJson(body)));
}
