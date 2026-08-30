"""
The watcher.

Two properties matter here. It has to catch every breach the demo depends on,
and it must not cry wolf on a compliant decision — a watcher that flags honest
agents would make the reputation score worthless.
"""

from __future__ import annotations

import pytest

from praxis.policy import POLICIES, DAOVotingPolicy, LendingPolicy, PolicyWatcher, TradingPolicy


@pytest.fixture
def watcher() -> PolicyWatcher:
    return PolicyWatcher()


# --------------------------------------------------------------------- trading


def test_trading_allows_an_allocation_under_the_cap(watcher):
    assert (
        watcher.inspect(
            "trading",
            {"asset": "ETH", "price": 3120.44},
            {"action": "BUY", "notional": 4000, "resultingAllocation": 0.12},
        )
        is None
    )


def test_trading_flags_an_allocation_over_the_cap(watcher):
    reason = watcher.inspect(
        "trading",
        {"asset": "ETH"},
        {"action": "BUY", "notional": 73000, "resultingAllocation": 0.85},
    )
    assert reason is not None
    assert "85%" in reason and "20%" in reason


def test_trading_allows_exactly_the_cap(watcher):
    """The policy says "more than 20%", so 20% itself is compliant."""
    assert watcher.inspect("trading", {"asset": "ETH"}, {"resultingAllocation": 0.20}) is None


def test_trading_flags_an_unapproved_asset(watcher):
    reason = watcher.inspect("trading", {"asset": "DOGE"}, {"resultingAllocation": 0.01})
    assert reason is not None and "DOGE" in reason


def test_trading_ignores_a_decision_with_no_allocation_stated(watcher):
    assert watcher.inspect("trading", {"asset": "ETH"}, {"action": "HOLD"}) is None


# ------------------------------------------------------------------ DAO voting


def test_dao_allows_yes_under_the_ceiling(watcher):
    assert (
        watcher.inspect(
            "dao-voting",
            {"proposal": "PIP-42", "treasuryImpact": 0.018, "touchesGovernance": False},
            {"action": "YES"},
        )
        is None
    )


def test_dao_flags_yes_over_the_ceiling(watcher):
    reason = watcher.inspect(
        "dao-voting",
        {"proposal": "PIP-45", "treasuryImpact": 0.34, "touchesGovernance": False},
        {"action": "YES"},
    )
    assert reason is not None and "34%" in reason


def test_dao_allows_no_over_the_ceiling(watcher):
    """The ceiling constrains YES votes; voting NO on an expensive proposal is fine."""
    assert (
        watcher.inspect(
            "dao-voting",
            {"treasuryImpact": 0.34, "touchesGovernance": False},
            {"action": "NO"},
        )
        is None
    )


def test_dao_requires_abstention_on_governance_parameters(watcher):
    reason = watcher.inspect(
        "dao-voting",
        {"proposal": "PIP-43", "treasuryImpact": 0.0, "touchesGovernance": True},
        {"action": "YES"},
    )
    assert reason is not None and "ABSTAIN" in reason


def test_dao_allows_abstaining_on_governance_parameters(watcher):
    assert (
        watcher.inspect(
            "dao-voting", {"treasuryImpact": 0.0, "touchesGovernance": True}, {"action": "ABSTAIN"}
        )
        is None
    )


# --------------------------------------------------------------------- lending


def test_lending_allows_a_well_collateralised_loan(watcher):
    assert (
        watcher.inspect(
            "lending",
            {"principal": 12000, "collateral": 20160, "collateralRatio": 1.68},
            {"action": "APPROVE", "principal": 12000},
        )
        is None
    )


def test_lending_flags_thin_collateral(watcher):
    reason = watcher.inspect(
        "lending",
        {"principal": 30000, "collateralRatio": 1.32},
        {"action": "APPROVE", "principal": 30000},
    )
    assert reason is not None and "132%" in reason


def test_lending_flags_an_oversized_principal(watcher):
    reason = watcher.inspect(
        "lending",
        {"principal": 88000, "collateralRatio": 2.0},
        {"action": "APPROVE", "principal": 88000},
    )
    assert reason is not None and "cap" in reason


def test_lending_reports_both_breaches_at_once(watcher):
    reason = watcher.inspect(
        "lending",
        {"principal": 88000, "collateralRatio": 1.04},
        {"action": "APPROVE", "principal": 88000},
    )
    assert reason is not None and "and" in reason


def test_lending_never_flags_a_rejection(watcher):
    """A policy about which loans to approve cannot be breached by declining one."""
    assert (
        watcher.inspect(
            "lending",
            {"principal": 88000, "collateralRatio": 1.04},
            {"action": "REJECT", "reason": "too thin"},
        )
        is None
    )


def test_lending_allows_exactly_the_floor_and_the_cap(watcher):
    assert (
        watcher.inspect(
            "lending",
            {"principal": 50000, "collateralRatio": 1.50},
            {"action": "APPROVE", "principal": 50000},
        )
        is None
    )


# ------------------------------------------------------------------- robustness


def test_an_unknown_kind_is_not_judged(watcher):
    assert watcher.inspect("weather-forecasting", {}, {"action": "RAIN"}) is None


def test_numeric_strings_are_still_checked(watcher):
    """A model that returns "0.85" instead of 0.85 must not slip past the watcher."""
    reason = watcher.inspect("trading", {"asset": "ETH"}, {"resultingAllocation": "0.85"})
    assert reason is not None


def test_garbage_fields_do_not_raise(watcher):
    assert watcher.inspect("trading", {"asset": None}, {"resultingAllocation": "banana"}) is None


# ------------------------------------------------------------------ declarations


@pytest.mark.parametrize("kind", ["trading", "dao-voting", "lending"])
def test_every_policy_declares_itself_in_plain_language(kind):
    described = POLICIES[kind].describe()
    assert len(described) > 40 and described.endswith(".")


def test_the_declaration_states_the_number_the_rule_enforces():
    """The sentence on the agent card and the rule the watcher applies are one object."""
    assert "20%" in TradingPolicy().describe()
    assert "5%" in DAOVotingPolicy().describe()
    assert "150%" in LendingPolicy().describe() and "50,000" in LendingPolicy().describe()
