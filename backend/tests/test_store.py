"""
The off-chain trail store.

The store is the half of the commitment the chain doesn't hold, so the property
that matters is that it cannot hold something the chain never committed to.
"""

from __future__ import annotations

import pytest

from praxis.canonical import hash_trail
from praxis.store import TrailStore

BODY = {
    "attestationId": 1,
    "agentId": 1,
    "policy": "Never allocate more than 20% of the book to a single asset.",
    "inputs": {"asset": "ETH", "price": 3120.44, "currentAllocation": 0.08},
    "reasoning": "Inside the cap, on the approved list.",
    "output": {"action": "BUY", "notional": 4000, "resultingAllocation": 0.12},
    "nonce": "1735689600000-1",
}


def put(store: TrailStore, body=None, **overrides):
    body = body or BODY
    kwargs = dict(
        attestation_id=body["attestationId"],
        agent_id=body["agentId"],
        body=body,
        trail_hash=hash_trail(body),
        source="fallback",
        model=None,
        created_at=1_700_000_000,
    )
    kwargs.update(overrides)
    store.put(**kwargs)


def test_a_stored_trail_comes_back_intact(store):
    put(store)
    trail = store.get(1)
    assert trail is not None
    assert trail.policy == BODY["policy"]
    assert trail.inputs == BODY["inputs"]
    assert trail.output == BODY["output"]
    assert trail.nonce == BODY["nonce"]
    assert trail.trailHash == hash_trail(BODY)


def test_the_stored_trail_still_hashes_to_its_commitment(store):
    """The dashboard's check, done here: strip the metadata, re-hash, compare."""
    put(store)
    trail = store.get(1)
    recomputed = hash_trail(
        {
            "attestationId": trail.attestationId,
            "agentId": trail.agentId,
            "policy": trail.policy,
            "inputs": trail.inputs,
            "reasoning": trail.reasoning,
            "output": trail.output,
            "nonce": trail.nonce,
        }
    )
    assert recomputed == trail.trailHash


def test_a_body_that_does_not_match_its_commitment_is_refused(store):
    """A store that can hold this is a store that can lie about what an agent decided."""
    with pytest.raises(ValueError, match="hashes to"):
        put(store, trail_hash="0x" + "00" * 32)


def test_a_missing_trail_returns_none(store):
    assert store.get(404) is None


def test_the_source_and_model_are_kept_out_of_the_hashed_body(store):
    """They are transport metadata; the dashboard strips them before verifying."""
    put(store, source="ollama", model="gemma3")
    trail = store.get(1)
    assert (trail.source, trail.model) == ("ollama", "gemma3")
    assert store.body(1) == BODY  # unchanged by the metadata


def test_writing_the_same_attestation_twice_replaces_it(store):
    put(store)
    revised = {**BODY, "reasoning": "Revised after a re-read."}
    put(store, body=revised)
    assert store.count() == 1
    assert store.get(1).reasoning == "Revised after a re-read."


def test_clear_empties_the_store(store):
    put(store)
    store.clear()
    assert store.count() == 0
    assert store.get(1) is None


def test_non_ascii_survives_the_round_trip(store):
    body = {**BODY, "reasoning": "Politique dépassée — 85 % du livre 🚨"}
    put(store, body=body)
    assert store.get(1).reasoning == body["reasoning"]
    assert store.get(1).trailHash == hash_trail(body)


def test_the_store_persists_across_reopening(tmp_path):
    path = tmp_path / "trails.db"
    first = TrailStore(path)
    put(first)
    first.close()

    second = TrailStore(path)
    try:
        assert second.get(1) is not None
        assert second.count() == 1
    finally:
        second.close()


def test_the_parent_directory_is_created(tmp_path):
    store = TrailStore(tmp_path / "nested" / "deeper" / "trails.db")
    try:
        put(store)
        assert store.count() == 1
    finally:
        store.close()
