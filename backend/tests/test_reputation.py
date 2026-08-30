"""
Reputation parity with ``ReputationScore.sol``.

The score is the number a judge reads off the agent card and the number another
protocol would read off the chain. If the Python port and the Solidity disagree,
the dashboard is lying about the on-chain state.
"""

from __future__ import annotations

import pytest

from praxis.reputation import Reputation, ReputationInputs, compute_reputation, tier_of
from praxis.units import to_wei

NOW = 1_700_000_000
DAY = 86_400


def inputs(**overrides) -> ReputationInputs:
    base = dict(
        active=True,
        bond_wei=to_wei(1_000),
        min_bond_wei=to_wei(1_000),
        total_slashed_wei=0,
        slash_count=0,
        clean_attestations=0,
        registered_at=NOW,
        open_disputes=0,
        defended_disputes=0,
        now=NOW,
    )
    base.update(overrides)
    return ReputationInputs(**base)


def test_a_fresh_agent_scores_the_base():
    assert compute_reputation(inputs()).score == Reputation.BASE_SCORE


def test_an_inactive_agent_scores_zero():
    """An agent slashed under minBond is out of the system entirely."""
    result = compute_reputation(inputs(active=False, clean_attestations=100))
    assert result.score == 0
    assert result.attestation_bonus == 0


def test_clean_attestations_add_five_each_up_to_the_cap():
    assert compute_reputation(inputs(clean_attestations=10)).attestation_bonus == 50
    assert (
        compute_reputation(inputs(clean_attestations=1_000)).attestation_bonus
        == Reputation.MAX_ATTESTATION_BONUS
    )


def test_longevity_adds_two_a_day_up_to_the_cap():
    assert compute_reputation(inputs(registered_at=NOW - 3 * DAY)).longevity_bonus == 6
    assert (
        compute_reputation(inputs(registered_at=NOW - 400 * DAY)).longevity_bonus
        == Reputation.MAX_LONGEVITY_BONUS
    )


def test_longevity_truncates_partial_days():
    """Solidity's integer division, not rounding."""
    assert compute_reputation(inputs(registered_at=NOW - DAY - 1)).longevity_bonus == 2


def test_a_future_registration_does_not_go_negative():
    assert compute_reputation(inputs(registered_at=NOW + DAY)).longevity_bonus == 0


def test_excess_bond_adds_twenty_five_per_multiple_up_to_the_cap():
    assert compute_reputation(inputs(bond_wei=to_wei(3_000))).bond_bonus == 50
    assert compute_reputation(inputs(bond_wei=to_wei(10_000))).bond_bonus == Reputation.MAX_BOND_BONUS


def test_bond_at_the_floor_earns_nothing():
    assert compute_reputation(inputs(bond_wei=to_wei(1_000))).bond_bonus == 0


def test_defended_disputes_add_twenty_each_up_to_the_cap():
    assert compute_reputation(inputs(defended_disputes=2)).defense_bonus == 40
    assert compute_reputation(inputs(defended_disputes=9)).defense_bonus == Reputation.MAX_DEFENSE_BONUS


def test_each_slash_costs_one_hundred_and_fifty():
    assert compute_reputation(inputs(slash_count=2)).slash_penalty == 300


def test_each_open_dispute_costs_forty():
    assert compute_reputation(inputs(open_disputes=2)).dispute_penalty == 80


def test_severity_scales_with_the_share_of_lifetime_bond_burned():
    """totalSlashed * 200 / (bond + totalSlashed)."""
    result = compute_reputation(inputs(bond_wei=to_wei(8_000), total_slashed_wei=to_wei(2_000)))
    assert result.severity_penalty == (2_000 * 200) // 10_000


def test_severity_is_zero_without_a_slash():
    assert compute_reputation(inputs(bond_wei=to_wei(8_000))).severity_penalty == 0


def test_the_score_floors_at_zero_rather_than_going_negative():
    assert compute_reputation(inputs(slash_count=10)).score == 0


def test_the_score_caps_at_the_maximum():
    result = compute_reputation(
        inputs(
            clean_attestations=1_000,
            registered_at=NOW - 400 * DAY,
            bond_wei=to_wei(100_000),
            defended_disputes=10,
        )
    )
    assert result.score == Reputation.MAX_SCORE


def test_the_end_to_end_slash_matches_the_ledger():
    """10,000 PRAX bonded, one clean attestation, then a 20% slash."""
    before = compute_reputation(inputs(bond_wei=to_wei(10_000), clean_attestations=1)).score
    after = compute_reputation(
        inputs(
            bond_wei=to_wei(8_000),
            total_slashed_wei=to_wei(2_000),
            slash_count=1,
            clean_attestations=0,
        )
    ).score
    # base + 5/clean + bond bonus (capped at 100)
    assert before == 500 + 5 + 100
    # base + bond bonus on the reduced 8,000 (still capped) - slash - severity
    assert after == 500 + 100 - 150 - 40
    assert after < before


@pytest.mark.parametrize(
    ("score", "tier"),
    [
        (1000, "TRUSTED"),
        (800, "TRUSTED"),
        (799, "RELIABLE"),
        (600, "RELIABLE"),
        (599, "NEUTRAL"),
        (400, "NEUTRAL"),
        (399, "WATCH"),
        (200, "WATCH"),
        (199, "UNTRUSTED"),
        (0, "UNTRUSTED"),
    ],
)
def test_tier_boundaries(score, tier):
    assert tier_of(score) == tier
