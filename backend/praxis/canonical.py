"""
Canonical serialisation of a decision trail.

The trail hash is a commitment shared by three parties: this orchestrator writes
it, ``ActionAttestation.sol`` stores it, and the dashboard re-derives it in the
browser to prove the revealed trail was not rewritten after the fact. If the
three disagree about which bytes get hashed, the dashboard's verification banner
goes red on honest data and the whole tamper-evidence claim collapses.

So the rule is fixed, and it is the same rule as
``frontend/src/lib/canonical.ts``:

  * object keys sorted lexicographically, recursively
  * no insignificant whitespace  (``separators=(",", ":")``)
  * arrays keep their order
  * keccak256 over the UTF-8 bytes of the resulting string

Two details are easy to get wrong going from JavaScript to Python, and both are
handled here rather than left to the caller:

``ensure_ascii``
    Python escapes non-ASCII by default (``"\\u00e9"``); ``JSON.stringify`` does
    not. We serialise with ``ensure_ascii=False`` to match.

Integral floats
    ``JSON.stringify(4000.0)`` is ``"4000"``; ``json.dumps(4000.0)`` is
    ``"4000.0"``. A policy input that arrives as a float from an LLM response
    would hash differently from the same value in the browser. Integral floats
    are narrowed to ``int`` before serialisation.

The one divergence left is key ordering for astral-plane characters: JavaScript
sorts by UTF-16 code unit, Python by code point, and the two disagree above
U+FFFF. Trail keys are ASCII identifiers, so this never fires in practice.
"""

from __future__ import annotations

import json
import math
from typing import Any

from eth_utils import keccak

__all__ = ["canonicalize", "canonical_trail_json", "hash_trail", "TRAIL_BODY_KEYS"]

#: Fields of a decision trail that form the hashed commitment. ``source``,
#: ``model`` and ``trailHash`` are transport metadata and are deliberately
#: excluded -- the dashboard strips exactly these before recomputing
#: (see ``verifyTrail`` in frontend/src/lib/api.ts).
TRAIL_BODY_KEYS = (
    "attestationId",
    "agentId",
    "policy",
    "inputs",
    "reasoning",
    "output",
    "nonce",
)


def canonicalize(value: Any) -> Any:
    """Recursively sort object keys and narrow integral floats.

    Raises ``ValueError`` on NaN/Infinity: JavaScript would serialise those as
    ``null`` and the hashes would silently diverge, which is worse than failing.
    """
    if isinstance(value, bool):
        # bool is a subclass of int, so this must come first.
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"cannot canonicalise non-finite number: {value!r}")
        return int(value) if value.is_integer() else value
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key in sorted(value):
            if not isinstance(key, str):
                raise TypeError(f"trail object keys must be strings, got {type(key).__name__}")
            out[key] = canonicalize(value[key])
        return out
    if isinstance(value, (list, tuple)):
        return [canonicalize(item) for item in value]
    return value


def canonical_trail_json(body: dict[str, Any]) -> str:
    """Deterministic JSON for a trail body -- the exact string that gets hashed."""
    return json.dumps(
        canonicalize(body),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def hash_trail(body: dict[str, Any]) -> str:
    """keccak256 over the canonical JSON, as ``0x``-prefixed hex.

    This is the value committed on-chain and the value the dashboard checks.
    """
    return "0x" + keccak(text=canonical_trail_json(body)).hex()
