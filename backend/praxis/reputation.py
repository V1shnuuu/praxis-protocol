"""
A faithful Python port of ``contracts/contracts/ReputationScore.sol``.

Used by the simulated ledger, so a run without a chain produces the same numbers
a run against Amoy would. Against a live deployment the contract is authoritative
and this module is not consulted for the score — but it is still the reference
the tests check the contract's shape against.

Keep it in step with the Solidity. Every constant, cap and division below has a
counterpart there, and integer division is deliberate: Solidity truncates, so
this does too.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["Reputation", "ReputationInputs", "Breakdown", "compute_reputation", "tier_of"]


class Reputation:
    MAX_SCORE = 1000
    BASE_SCORE = 500

    POINTS_PER_CLEAN_ATTESTATION = 5
    MAX_ATTESTATION_BONUS = 250

    POINTS_PER_DAY = 2
    MAX_LONGEVITY_BONUS = 100

    POINTS_PER_EXCESS_BOND_MULTIPLE = 25
    MAX_BOND_BONUS = 100

    POINTS_PER_DEFENDED_DISPUTE = 20
    MAX_DEFENSE_BONUS = 60

    PENALTY_PER_SLASH = 150
    MAX_SEVERITY_PENALTY = 200
    PENALTY_PER_OPEN_DISPUTE = 40

    SECONDS_PER_DAY = 86_400


@dataclass(frozen=True)
class ReputationInputs:
    active: bool
    bond_wei: int
    min_bond_wei: int
    total_slashed_wei: int
    slash_count: int
    clean_attestations: int
    registered_at: int
    open_disputes: int
    defended_disputes: int
    now: int


@dataclass(frozen=True)
class Breakdown:
    score: int
    base: int
    attestation_bonus: int
    longevity_bonus: int
    bond_bonus: int
    defense_bonus: int
    slash_penalty: int
    severity_penalty: int
    dispute_penalty: int


def _cap(value: int, maximum: int) -> int:
    return maximum if value > maximum else value


def compute_reputation(i: ReputationInputs) -> Breakdown:
    """Mirror of ``ReputationScore.breakdownOf``."""
    # An agent slashed below the minimum bond is out of the system entirely.
    if not i.active:
        return Breakdown(0, Reputation.BASE_SCORE, 0, 0, 0, 0, 0, 0, 0)

    attestation_bonus = _cap(
        i.clean_attestations * Reputation.POINTS_PER_CLEAN_ATTESTATION,
        Reputation.MAX_ATTESTATION_BONUS,
    )

    days_active = (i.now - i.registered_at) // Reputation.SECONDS_PER_DAY if i.now > i.registered_at else 0
    longevity_bonus = _cap(days_active * Reputation.POINTS_PER_DAY, Reputation.MAX_LONGEVITY_BONUS)

    bond_bonus = 0
    if i.min_bond_wei > 0 and i.bond_wei > i.min_bond_wei:
        excess_multiples = (i.bond_wei - i.min_bond_wei) // i.min_bond_wei
        bond_bonus = _cap(
            excess_multiples * Reputation.POINTS_PER_EXCESS_BOND_MULTIPLE, Reputation.MAX_BOND_BONUS
        )

    defense_bonus = _cap(
        i.defended_disputes * Reputation.POINTS_PER_DEFENDED_DISPUTE, Reputation.MAX_DEFENSE_BONUS
    )

    slash_penalty = i.slash_count * Reputation.PENALTY_PER_SLASH
    dispute_penalty = i.open_disputes * Reputation.PENALTY_PER_OPEN_DISPUTE

    # Severity: how much of the bond the agent ever posted has been burned.
    lifetime_bond = i.bond_wei + i.total_slashed_wei
    severity_penalty = (
        (i.total_slashed_wei * Reputation.MAX_SEVERITY_PENALTY) // lifetime_bond
        if lifetime_bond > 0 and i.total_slashed_wei > 0
        else 0
    )

    positive = Reputation.BASE_SCORE + attestation_bonus + longevity_bonus + bond_bonus + defense_bonus
    negative = slash_penalty + severity_penalty + dispute_penalty
    score = _cap(positive - negative, Reputation.MAX_SCORE) if positive > negative else 0

    return Breakdown(
        score=score,
        base=Reputation.BASE_SCORE,
        attestation_bonus=attestation_bonus,
        longevity_bonus=longevity_bonus,
        bond_bonus=bond_bonus,
        defense_bonus=defense_bonus,
        slash_penalty=slash_penalty,
        severity_penalty=severity_penalty,
        dispute_penalty=dispute_penalty,
    )


def tier_of(score: int) -> str:
    """Mirror of ``ReputationScore.tierOf``."""
    if score >= 800:
        return "TRUSTED"
    if score >= 600:
        return "RELIABLE"
    if score >= 400:
        return "NEUTRAL"
    if score >= 200:
        return "WATCH"
    return "UNTRUSTED"
