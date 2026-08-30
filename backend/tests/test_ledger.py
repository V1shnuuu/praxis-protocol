"""
The simulated ledger against the contracts it mirrors.

Each test names the Solidity behaviour it pins. If ``contracts/`` changes an
economic rule, one of these should be what tells you the orchestrator drifted.
"""

from __future__ import annotations

import pytest

from praxis.ledger import LedgerError, SimulatedLedger
from praxis.units import to_wei

from .conftest import CHALLENGE_FEE, CHALLENGE_WINDOW, MIN_BOND


def _register(ledger: SimulatedLedger, bond=to_wei(10_000), name="TradingAgent") -> int:
    return ledger.register(
        owner_hint="", name=name, metadata_uri="never over 20% in one asset", bond_wei=bond
    ).id


def _attest(ledger: SimulatedLedger, agent_id: int) -> int:
    return ledger.attest(
        agent_id=agent_id, trail_hash="0x" + "11" * 32, action_type="TRADE", summary="BUY"
    ).id


# --------------------------------------------------------------------- registry


def test_register_assigns_sequential_ids_and_holds_the_bond(ledger):
    first = _register(ledger, name="A")
    second = _register(ledger, name="B")
    assert (first, second) == (1, 2)
    assert ledger.agent(first).bond_wei == to_wei(10_000)
    assert ledger.agent(first).active is True


def test_register_below_the_minimum_bond_is_refused(ledger):
    """AgentRegistry.register reverts under minBond."""
    with pytest.raises(LedgerError, match="below the minimum"):
        _register(ledger, bond=MIN_BOND - 1)


def test_unknown_agent_reads_raise(ledger):
    with pytest.raises(LedgerError, match="unknown agent"):
        ledger.agent(99)


# ----------------------------------------------------------------- attestations


def test_attest_appends_to_the_agents_log(ledger):
    agent_id = _register(ledger)
    _attest(ledger, agent_id)
    _attest(ledger, agent_id)
    state = ledger.agent(agent_id)
    assert state.total_attestations == 2
    assert state.clean_attestations == 2


def test_next_attestation_id_predicts_the_assignment(ledger):
    agent_id = _register(ledger)
    predicted = ledger.next_attestation_id()
    assert _attest(ledger, agent_id) == predicted


def test_an_inactive_agent_cannot_attest(ledger, clock):
    """ActionAttestation.attest requires registry.isActive."""
    agent_id = _register(ledger, bond=to_wei(1_200))
    attestation_id = _attest(ledger, agent_id)
    dispute_id = ledger.open_dispute(attestation_id=attestation_id, reason="breach").id
    ledger.resolve(dispute_id=dispute_id, upheld=True)

    assert ledger.agent(agent_id).active is False
    with pytest.raises(LedgerError, match="not active"):
        _attest(ledger, agent_id)


# --------------------------------------------------------------------- disputes


def test_opening_a_dispute_locks_the_amount_at_risk(ledger):
    """DisputeSlashing.openDispute locks bond * slashBps / 10_000."""
    agent_id = _register(ledger)
    attestation_id = _attest(ledger, agent_id)
    ledger.open_dispute(attestation_id=attestation_id, reason="85% in one asset")

    state = ledger.agent(agent_id)
    assert state.locked_bond_wei == to_wei(2_000)  # 20% of 10,000
    assert state.open_disputes == 1
    assert ledger.attestation(attestation_id).disputed is True


def test_one_open_dispute_per_attestation(ledger):
    agent_id = _register(ledger)
    attestation_id = _attest(ledger, agent_id)
    ledger.open_dispute(attestation_id=attestation_id, reason="first")
    with pytest.raises(LedgerError, match="already has open dispute"):
        ledger.open_dispute(attestation_id=attestation_id, reason="second")


def test_the_challenge_window_closes(ledger, clock):
    """DisputeSlashing reverts once block.timestamp passes timestamp + challengeWindow."""
    agent_id = _register(ledger)
    attestation_id = _attest(ledger, agent_id)
    clock.advance(CHALLENGE_WINDOW + 1)
    with pytest.raises(LedgerError, match="challenge window"):
        ledger.open_dispute(attestation_id=attestation_id, reason="too late")


def test_disputing_an_unknown_attestation_raises(ledger):
    with pytest.raises(LedgerError, match="unknown attestation"):
        ledger.open_dispute(attestation_id=404, reason="nothing there")


# -------------------------------------------------------------------- resolution


def test_upheld_dispute_slashes_and_pays_the_challenger(ledger):
    """20% of the bond burned; challenger takes 50% of the slash plus their fee back."""
    agent_id = _register(ledger)
    attestation_id = _attest(ledger, agent_id)
    dispute_id = ledger.open_dispute(attestation_id=attestation_id, reason="breach").id

    ledger.resolve(dispute_id=dispute_id, upheld=True)
    dispute = ledger.dispute(dispute_id)
    agent = ledger.agent(agent_id)

    assert dispute.status == "upheld"
    assert dispute.slashed_wei == to_wei(2_000)
    assert dispute.challenger_payout_wei == to_wei(1_000) + CHALLENGE_FEE
    assert dispute.bond_before_wei == to_wei(10_000)
    assert dispute.bond_after_wei == to_wei(8_000)
    assert agent.bond_wei == to_wei(8_000)
    assert agent.total_slashed_wei == to_wei(2_000)
    assert agent.slash_count == 1
    assert agent.locked_bond_wei == 0
    assert agent.open_disputes == 0


def test_upheld_dispute_marks_the_attestation_slashed(ledger):
    agent_id = _register(ledger)
    attestation_id = _attest(ledger, agent_id)
    dispute_id = ledger.open_dispute(attestation_id=attestation_id, reason="breach").id
    ledger.resolve(dispute_id=dispute_id, upheld=True)

    attestation = ledger.attestation(attestation_id)
    assert (attestation.slashed, attestation.disputed) == (True, False)
    # cleanByAgent = total - slashed
    assert ledger.agent(agent_id).clean_attestations == 0


def test_rejected_dispute_credits_the_fee_to_the_agent(ledger):
    """A false accusation leaves an honest agent better off than before."""
    agent_id = _register(ledger)
    attestation_id = _attest(ledger, agent_id)
    dispute_id = ledger.open_dispute(attestation_id=attestation_id, reason="wrong").id

    ledger.resolve(dispute_id=dispute_id, upheld=False)
    dispute = ledger.dispute(dispute_id)
    agent = ledger.agent(agent_id)

    assert dispute.status == "rejected"
    assert dispute.slashed_wei == 0
    assert dispute.challenger_payout_wei == 0
    assert agent.bond_wei == to_wei(10_000) + CHALLENGE_FEE
    assert agent.slash_count == 0
    assert agent.rejected_disputes == 1
    assert ledger.attestation(attestation_id).slashed is False


def test_a_slash_below_the_minimum_deactivates_the_agent(ledger):
    """AgentRegistry.slash flips active off when the remainder is under minBond."""
    agent_id = _register(ledger, bond=to_wei(1_100))
    attestation_id = _attest(ledger, agent_id)
    dispute_id = ledger.open_dispute(attestation_id=attestation_id, reason="breach").id
    ledger.resolve(dispute_id=dispute_id, upheld=True)

    agent = ledger.agent(agent_id)
    assert agent.bond_wei == to_wei(880)
    assert agent.active is False
    assert ledger.reputation(agent_id) == 0


def test_a_dispute_resolves_only_once(ledger):
    agent_id = _register(ledger)
    attestation_id = _attest(ledger, agent_id)
    dispute_id = ledger.open_dispute(attestation_id=attestation_id, reason="breach").id
    ledger.resolve(dispute_id=dispute_id, upheld=True)
    with pytest.raises(LedgerError, match="not open"):
        ledger.resolve(dispute_id=dispute_id, upheld=True)


def test_locked_bond_is_clamped_to_the_free_balance(ledger):
    """lockBond clamps to bond - lockedBond, so two disputes cannot over-reserve."""
    agent_id = _register(ledger)
    first = _attest(ledger, agent_id)
    second = _attest(ledger, agent_id)
    ledger.open_dispute(attestation_id=first, reason="a")
    ledger.open_dispute(attestation_id=second, reason="b")
    agent = ledger.agent(agent_id)
    assert agent.locked_bond_wei <= agent.bond_wei
    assert agent.open_disputes == 2


# ------------------------------------------------------------------ reputation


def test_reputation_drops_across_the_whole_flow(ledger):
    agent_id = _register(ledger)
    attestation_id = _attest(ledger, agent_id)
    before = ledger.reputation(agent_id)

    dispute_id = ledger.open_dispute(attestation_id=attestation_id, reason="breach").id
    during = ledger.reputation(agent_id)
    ledger.resolve(dispute_id=dispute_id, upheld=True)
    after = ledger.reputation(agent_id)

    assert during == before - 40  # PENALTY_PER_OPEN_DISPUTE
    assert after < during


def test_reset_clears_everything(ledger):
    agent_id = _register(ledger)
    _attest(ledger, agent_id)
    ledger.reset()
    assert ledger.next_attestation_id() == 1
    with pytest.raises(LedgerError):
        ledger.agent(1)


def test_info_reports_the_configured_economics(ledger):
    info = ledger.info()
    assert info.mode == "simulated"
    assert info.min_bond_wei == MIN_BOND
    assert info.slash_bps == 2000
    assert info.challenge_window_seconds == CHALLENGE_WINDOW
