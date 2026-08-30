"""
The constants ``chain.py`` decodes contract data with.

These are the parts of the live path that unit tests can check without an RPC
endpoint, and they are exactly the parts that fail silently when they are wrong:
a struct field read from the wrong index, or an enum numbered from the wrong
base, produces plausible-looking data rather than an error.

That is not hypothetical. ``Status`` leads with ``None``, so ``Open`` is 1 —
mapping it from 0 reported every open dispute as ``upheld``, which showed a
false "bond slashed" verdict on the dashboard and made ``resolve`` refuse to run
because the dispute already looked decided. It took a real chain to notice.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from praxis.chain import _DISPUTE_STATUS, CONTRACT_NAMES, _hex, _to_bytes32
from praxis.ledger import LedgerError

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACT_SRC = REPO_ROOT / "contracts" / "contracts"
ABI_DIR = REPO_ROOT / "deployments" / "abis"


def _abi(name: str) -> list:
    return json.loads((ABI_DIR / f"{name}.json").read_text(encoding="utf-8"))["abi"]


def _tuple_fields(contract: str, function: str) -> list[str]:
    """Field names of a function's returned struct, in ABI (declaration) order."""
    for entry in _abi(contract):
        if entry.get("name") == function:
            return [c["name"] for c in entry["outputs"][0]["components"]]
    raise AssertionError(f"{function} not found in {contract}'s ABI")


# --------------------------------------------------------------- the enum


def test_dispute_status_matches_the_solidity_enum():
    """Read the enum out of the source rather than trusting a comment."""
    source = (CONTRACT_SRC / "DisputeSlashing.sol").read_text(encoding="utf-8")
    body = re.search(r"enum Status \{(.*?)\}", source, re.DOTALL)
    assert body, "Status enum not found in DisputeSlashing.sol"

    members = [m.strip() for m in body.group(1).split(",") if m.strip()]
    declared = {index: name.lower() for index, name in enumerate(members)}

    # Every status the orchestrator can act on maps to the right ordinal, and
    # `None` is deliberately absent — it means the dispute was never written.
    assert declared[0] == "none"
    for ordinal, label in _DISPUTE_STATUS.items():
        assert declared[ordinal] == label, f"ordinal {ordinal} is {declared[ordinal]!r}, not {label!r}"
    assert set(_DISPUTE_STATUS) == set(declared) - {0}


# ------------------------------------------------------- the struct layouts


def test_dispute_struct_indices():
    """chain.dispute() reads getDispute() by position; pin every one it uses."""
    fields = _tuple_fields("DisputeSlashing", "getDispute")
    expected = {
        0: "id",
        1: "attestationId",
        2: "agentId",
        3: "challenger",
        4: "fee",
        5: "reason",
        6: "openedAt",
        7: "resolvedAt",
        9: "slashedAmount",
        10: "challengerPayout",
        11: "bondBefore",
        12: "bondAfter",
        13: "status",
    }
    for index, name in expected.items():
        assert fields[index] == name, f"index {index} is {fields[index]!r}, not {name!r}"


def test_agent_struct_indices():
    fields = _tuple_fields("AgentRegistry", "getAgent")
    expected = {
        0: "id",
        1: "owner",
        2: "name",
        3: "metadataURI",
        4: "bond",
        5: "lockedBond",
        6: "registeredAt",
        7: "totalSlashed",
        8: "slashCount",
        9: "active",
    }
    for index, name in expected.items():
        assert fields[index] == name, f"index {index} is {fields[index]!r}, not {name!r}"


def test_attestation_struct_indices():
    fields = _tuple_fields("ActionAttestation", "getAttestation")
    expected = {
        0: "id",
        1: "agentId",
        2: "trailHash",
        3: "actionType",
        4: "summary",
        5: "timestamp",
        7: "disputed",
        8: "slashed",
    }
    for index, name in expected.items():
        assert fields[index] == name, f"index {index} is {fields[index]!r}, not {name!r}"


def test_every_contract_the_ledger_needs_has_an_abi():
    for name in CONTRACT_NAMES:
        assert (ABI_DIR / f"{name}.json").exists(), f"{name}.json is missing from deployments/abis"


def test_the_functions_the_ledger_calls_exist():
    """A renamed contract function would otherwise surface only at runtime."""
    required = {
        "AgentRegistry": {"register", "getAgent", "minBond", "agentCount", "agentsOfOwner"},
        "ActionAttestation": {
            "attest",
            "getAttestation",
            "attestationCount",
            "totalByAgent",
            "cleanByAgent",
        },
        "DisputeSlashing": {
            "openDispute",
            "resolve",
            "getDispute",
            "disputeCount",
            "challengeFee",
            "challengeWindow",
            "slashBps",
            "challengerRewardBps",
            "openDisputesByAgent",
            "rejectedDisputesByAgent",
        },
        "ReputationScore": {"scoreOf"},
        "PraxisToken": {"balanceOf", "approve", "allowance"},
    }
    for contract, functions in required.items():
        available = {e.get("name") for e in _abi(contract) if e.get("type") == "function"}
        missing = functions - available
        assert not missing, f"{contract} is missing {sorted(missing)}"


def test_the_events_the_ledger_reads_ids_from_exist():
    required = {
        "AgentRegistry": "AgentRegistered",
        "ActionAttestation": "AttestationSubmitted",
        "DisputeSlashing": "DisputeOpened",
    }
    for contract, event in required.items():
        names = {e.get("name") for e in _abi(contract) if e.get("type") == "event"}
        assert event in names, f"{contract} has no {event} event"


# ------------------------------------------------------------------ helpers


class _Receipt(dict):
    pass


class _Bare:
    """hexbytes 1.x: .hex() returns bare hex, no 0x."""

    def hex(self) -> str:
        return "abc123"


class _Prefixed:
    """hexbytes 0.x: .hex() returns it prefixed."""

    def hex(self) -> str:
        return "0xabc123"


@pytest.mark.parametrize("value", [_Bare(), _Prefixed()])
def test_transaction_hashes_are_always_prefixed(value):
    """The dashboard builds explorer links by concatenation; a bare hash 404s."""
    assert _hex(_Receipt(transactionHash=value)) == "0xabc123"


def test_trail_hash_converts_to_bytes32():
    assert _to_bytes32("0x" + "11" * 32) == b"\x11" * 32
    assert _to_bytes32("11" * 32) == b"\x11" * 32  # tolerates a missing prefix


@pytest.mark.parametrize("bad", ["0x1234", "0x" + "11" * 31, "0x" + "11" * 33])
def test_a_wrong_length_trail_hash_is_refused(bad):
    with pytest.raises(LedgerError, match="32 bytes"):
        _to_bytes32(bad)
