"""
Declared policies, and the watcher that checks decisions against them.

Each policy exists twice over: as the plain-language sentence the agent
registers on-chain (``describe``), and as a machine-checkable rule
(``check``). Keeping both in one object is what stops the two drifting — the
string a judge reads on the agent card is the same rule the watcher enforces.

The watcher is deliberately independent of the agent. It re-reads the committed
decision and reaches its own verdict, so a violation is *detected*, not
self-reported. An agent in rogue mode does not announce it; it simply commits a
decision that breaks its declared policy, and the watcher catches it the same
way it would catch an honest mistake or a jailbroken model.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

__all__ = ["Policy", "TradingPolicy", "DAOVotingPolicy", "LendingPolicy", "POLICIES", "PolicyWatcher"]


class Policy(Protocol):
    kind: str

    def describe(self) -> str:
        """The plain-language policy registered on-chain."""

    def check(self, inputs: dict[str, Any], output: dict[str, Any]) -> str | None:
        """The violation this decision commits, or None if it is compliant."""


def _num(value: Any) -> float | None:
    """Reads a number out of a trail field, tolerating strings and missing keys."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value))
    except ValueError:
        return None


@dataclass(frozen=True)
class TradingPolicy:
    kind: str = "trading"
    max_allocation: float = 0.20
    approved_assets: tuple[str, ...] = ("ETH", "MATIC", "USDC")

    def describe(self) -> str:
        return (
            f"Never allocate more than {self.max_allocation:.0%} of the book to a single asset, "
            f"and never trade an asset outside the approved list "
            f"({', '.join(self.approved_assets)})."
        )

    def check(self, inputs: dict[str, Any], output: dict[str, Any]) -> str | None:
        # Only judge the asset when one was actually named. A missing or
        # non-string field is an incomplete record, not a trade in "NONE".
        raw_asset = inputs.get("asset")
        asset = raw_asset.strip().upper() if isinstance(raw_asset, str) else ""
        if asset and asset not in self.approved_assets:
            return (
                f"Traded {asset}, which is outside the approved list "
                f"({', '.join(self.approved_assets)})."
            )

        allocation = _num(output.get("resultingAllocation"))
        if allocation is not None and allocation > self.max_allocation:
            return (
                f"Allocated {allocation:.0%} of the book to a single asset; "
                f"declared cap is {self.max_allocation:.0%}."
            )
        return None


@dataclass(frozen=True)
class DAOVotingPolicy:
    kind: str = "dao-voting"
    max_treasury_impact: float = 0.05

    def describe(self) -> str:
        return (
            f"Vote YES only on proposals whose treasury impact is under "
            f"{self.max_treasury_impact:.0%} of holdings; abstain on anything touching "
            f"governance parameters."
        )

    def check(self, inputs: dict[str, Any], output: dict[str, Any]) -> str | None:
        action = str(output.get("action", "")).upper()
        impact = _num(inputs.get("treasuryImpact"))
        touches_governance = bool(inputs.get("touchesGovernance"))

        if touches_governance and action != "ABSTAIN":
            return f"Voted {action} on a proposal touching governance parameters; policy requires ABSTAIN."

        if action == "YES" and impact is not None and impact >= self.max_treasury_impact:
            return (
                f"Voted YES on a proposal with {impact:.0%} treasury impact; "
                f"declared ceiling is {self.max_treasury_impact:.0%}."
            )
        return None


@dataclass(frozen=True)
class LendingPolicy:
    kind: str = "lending"
    min_collateral_ratio: float = 1.50
    max_principal: float = 50_000

    def describe(self) -> str:
        return (
            f"Approve loans only at a collateralisation ratio of "
            f"{self.min_collateral_ratio:.0%} or above, and never above "
            f"{self.max_principal:,.0f} PRAX principal."
        )

    def check(self, inputs: dict[str, Any], output: dict[str, Any]) -> str | None:
        if str(output.get("action", "")).upper() != "APPROVE":
            return None  # A rejection can never breach a policy about approvals.

        ratio = _num(inputs.get("collateralRatio"))
        principal = _num(output.get("principal")) or _num(inputs.get("principal"))

        breaches: list[str] = []
        if ratio is not None and ratio < self.min_collateral_ratio:
            breaches.append(
                f"approved at {ratio:.0%} collateralisation, floor is {self.min_collateral_ratio:.0%}"
            )
        if principal is not None and principal > self.max_principal:
            breaches.append(
                f"principal of {principal:,.0f} PRAX exceeds the {self.max_principal:,.0f} PRAX cap"
            )

        if not breaches:
            return None
        return f"Loan {' and '.join(breaches)}."


#: One policy per agent kind, keyed the way ``AgentKind`` is in types.ts.
POLICIES: dict[str, Policy] = {
    "trading": TradingPolicy(),
    "dao-voting": DAOVotingPolicy(),
    "lending": LendingPolicy(),
}


class PolicyWatcher:
    """Reads committed decisions and reports the ones that breach their policy.

    This is the component that would, in production, be run by anyone with an
    interest in the agent behaving — a counterparty, an insurer, a competitor.
    It needs nothing but the public attestation and the revealed trail.
    """

    def __init__(self, policies: dict[str, Policy] | None = None):
        self._policies = policies or POLICIES

    def inspect(self, kind: str, inputs: dict[str, Any], output: dict[str, Any]) -> str | None:
        """The violation reason for a decision, or None if it is compliant."""
        policy = self._policies.get(kind)
        if policy is None:
            return None
        return policy.check(inputs, output)
