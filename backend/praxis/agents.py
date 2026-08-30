"""
The three agents, and the world they act in.

Each agent observes a small simulated environment, decides what to do, and hands
back a full reasoning trail: the inputs it saw, the reasoning it produced, and
the output it committed to. The orchestrator hashes that trail and puts the
digest on-chain; the trail itself goes to the store.

Two brains, one interface. ``decide`` asks the LLM first and falls back to a
deterministic rule when the model is unavailable, slow, or returns something
that isn't a decision. The trail records which one answered
(``source``/``model``), so the dashboard never has to guess.

Rogue mode is deliberately scripted rather than prompted. The point of the demo
is a decision that provably breaks the declared policy; leaving that to a model's
mood would make it neither reproducible nor guaranteed to breach. The agent does
not flag the breach — it simply commits it, and the watcher in ``policy.py``
finds it independently.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any

from .llm import Brain
from .policy import POLICIES, Policy

__all__ = ["Decision", "BaseAgent", "TradingAgent", "DAOVotingAgent", "LendingAgent", "build_agents"]


@dataclass
class Decision:
    action_type: str  # "TRADE" | "VOTE" | "LOAN"
    summary: str
    reasoning: str
    inputs: dict[str, Any]
    output: dict[str, Any]
    source: str = "fallback"  # "ollama" | "fallback"
    model: str | None = None


@dataclass(kw_only=True)
class BaseAgent:
    agent_id: int
    name: str
    kind: str
    bond_wei: int
    rng: random.Random = field(default_factory=random.Random)

    action_type = "TRADE"

    @property
    def policy_rule(self) -> Policy:
        return POLICIES[self.kind]

    @property
    def policy(self) -> str:
        """The plain-language policy registered on-chain."""
        return self.policy_rule.describe()

    # ------------------------------------------------------------- the world

    def observe(self) -> dict[str, Any]:
        """What the agent can see this tick."""
        raise NotImplementedError

    def rule_based(self, inputs: dict[str, Any]) -> tuple[dict[str, Any], str, str]:
        """Deterministic decision: ``(output, reasoning, summary)``."""
        raise NotImplementedError

    def rogue(self) -> tuple[dict[str, Any], dict[str, Any], str, str]:
        """The scripted breach: ``(inputs, output, reasoning, summary)``."""
        raise NotImplementedError

    def summarise(self, inputs: dict[str, Any], output: dict[str, Any]) -> str:
        """One-line feed summary for a decision the model produced."""
        raise NotImplementedError

    # ------------------------------------------------------------- decisions

    async def decide(self, brain: Brain) -> Decision:
        """A compliant-intent decision. The model answers if it can; the rule does otherwise."""
        inputs = self.observe()
        answer = await brain.decide(kind=self.kind, policy=self.policy, inputs=inputs)

        if answer is not None:
            # The model's decision is committed as-is, even if it breaches the
            # policy. Quietly correcting it here would hide exactly the failure
            # this protocol exists to make visible -- the watcher will catch it.
            return Decision(
                action_type=self.action_type,
                summary=self.summarise(inputs, answer.output),
                reasoning=answer.reasoning,
                inputs=inputs,
                output=answer.output,
                source="ollama",
                model=answer.model,
            )

        output, reasoning, summary = self.rule_based(inputs)
        return Decision(
            action_type=self.action_type,
            summary=summary,
            reasoning=reasoning,
            inputs=inputs,
            output=output,
        )

    def decide_rogue(self) -> Decision:
        """The deliberate policy breach behind the dashboard's rogue button."""
        inputs, output, reasoning, summary = self.rogue()
        return Decision(
            action_type=self.action_type,
            summary=summary,
            reasoning=reasoning,
            inputs=inputs,
            output=output,
        )


# --------------------------------------------------------------------- trading


@dataclass(kw_only=True)
class TradingAgent(BaseAgent):
    kind: str = "trading"
    action_type = "TRADE"

    prices: dict[str, float] = field(
        default_factory=lambda: {"ETH": 3120.44, "MATIC": 0.412, "USDC": 1.0}
    )
    allocations: dict[str, float] = field(
        default_factory=lambda: {"ETH": 0.08, "MATIC": 0.09, "USDC": 0.21}
    )
    book_value: float = 100_000.0

    def observe(self) -> dict[str, Any]:
        cap = self.policy_rule.max_allocation  # type: ignore[attr-defined]
        # An agent that finds itself over its own cap looks at that sleeve
        # first; anything else would leave a known breach sitting on the book.
        over_cap = [name for name, share in self.allocations.items() if share > cap]
        asset = over_cap[0] if over_cap else self.rng.choice(["ETH", "MATIC"])
        # A gentle random walk, so consecutive decisions differ without the
        # book ever doing anything implausible.
        drift = self.rng.uniform(-0.04, 0.04)
        self.prices[asset] = round(self.prices[asset] * (1 + drift), 4)
        self.book_value = round(self.book_value * (1 + self.rng.uniform(-0.01, 0.015)), 2)
        return {
            "asset": asset,
            "price": self.prices[asset],
            "bookValue": round(self.book_value, 2),
            "currentAllocation": round(self.allocations[asset], 4),
            "twentyDayMeanDeviation": round(drift, 4),
        }

    def rule_based(self, inputs: dict[str, Any]) -> tuple[dict[str, Any], str, str]:
        asset = inputs["asset"]
        current = float(inputs["currentAllocation"])
        deviation = float(inputs["twentyDayMeanDeviation"])
        cap = self.policy_rule.max_allocation  # type: ignore[attr-defined]
        book = float(inputs["bookValue"])

        if current > cap:
            # Over the declared cap -- from a rogue trade, or a price move that
            # inflated the sleeve. Unwinding to compliance comes before any view
            # on the market, and one trade has to be enough to get back inside.
            target = cap - 0.01
            notional = round((current - target) * book, 2)
            output = {
                "action": "SELL",
                "notional": notional,
                "resultingAllocation": round(target, 4),
            }
            reasoning = (
                f"The book is {current:.0%} {asset}, over the declared {cap:.0%} single-asset "
                f"cap. Selling ${notional:,.0f} unwinds the sleeve to {target:.0%} and brings the "
                f"position back inside the policy in one trade."
            )
            summary = f"SELL ${notional / 1000:.1f}k {asset} — unwind to {target:.0%}"
        elif deviation < -0.015 and current < cap - 0.03:
            # Cheap and there is headroom: buy up to, at most, 80% of the gap
            # to the cap, so a single trade can never land on the limit.
            target = min(cap - 0.01, current + (cap - current) * 0.8)
            notional = round((target - current) * book, 2)
            output = {
                "action": "BUY",
                "notional": notional,
                "resultingAllocation": round(target, 4),
            }
            reasoning = (
                f"{asset} is trading {abs(deviation):.1%} below its 20-day mean. A "
                f"${notional:,.0f} entry takes the {asset} sleeve from {current:.0%} to "
                f"{target:.0%} of the book, inside the {cap:.0%} single-asset cap, and "
                f"{asset} is on the approved list."
            )
            summary = f"BUY ${notional / 1000:.1f}k {asset} — {target:.0%} of book"
        elif deviation > 0.02 and current > 0.05:
            target = max(0.02, current - 0.02)
            notional = round((current - target) * book, 2)
            output = {
                "action": "SELL",
                "notional": notional,
                "resultingAllocation": round(target, 4),
            }
            reasoning = (
                f"{asset} ran {deviation:.1%} and the sleeve drifted to {current:.0%}. "
                f"Trimming ${notional:,.0f} brings it back to {target:.0%}, keeping headroom "
                f"under the {cap:.0%} cap."
            )
            summary = f"SELL ${notional / 1000:.1f}k {asset} — trim to {target:.0%}"
        else:
            target = current
            output = {"action": "HOLD", "notional": 0, "resultingAllocation": round(target, 4)}
            reasoning = (
                f"{asset} is inside its 1-sigma band and the order book shows no imbalance "
                f"worth acting on. Holding costs nothing and avoids churn; allocation stays "
                f"at {current:.0%}."
            )
            summary = f"HOLD {asset} — no edge"

        self.allocations[asset] = target
        return output, reasoning, summary

    def rogue(self) -> tuple[dict[str, Any], dict[str, Any], str, str]:
        asset = "ETH"
        current = round(self.allocations[asset], 4)
        inputs = {
            "asset": asset,
            "price": self.prices[asset],
            "bookValue": round(self.book_value, 2),
            "currentAllocation": current,
            "twentyDayMeanDeviation": 0.031,
        }
        notional = round((0.85 - current) * self.book_value, 2)
        output = {"action": "BUY", "notional": notional, "resultingAllocation": 0.85}
        reasoning = (
            "Momentum is unusually strong and I judge the expected value high enough to "
            "justify concentrating the book. Overriding the 20% single-asset cap and taking "
            "ETH to 85% of holdings."
        )
        summary = f"BUY ${notional / 1000:.0f}k {asset} — 85% of book"
        self.allocations[asset] = 0.85
        return inputs, output, reasoning, summary

    def summarise(self, inputs: dict[str, Any], output: dict[str, Any]) -> str:
        action = str(output.get("action", "?")).upper()
        notional = float(output.get("notional", 0) or 0)
        allocation = output.get("resultingAllocation")
        tail = f" — {float(allocation):.0%} of book" if allocation is not None else ""
        if action == "HOLD" or notional == 0:
            return f"HOLD {inputs.get('asset', '?')}{tail}"
        return f"{action} ${notional / 1000:.1f}k {inputs.get('asset', '?')}{tail}"


# ------------------------------------------------------------------ DAO voting


@dataclass(kw_only=True)
class DAOVotingAgent(BaseAgent):
    kind: str = "dao-voting"
    action_type = "VOTE"

    next_proposal: int = 42

    def observe(self) -> dict[str, Any]:
        proposal = f"PIP-{self.next_proposal}"
        self.next_proposal += 1
        touches_governance = self.rng.random() < 0.25
        impact = 0.0 if touches_governance else round(self.rng.uniform(0.005, 0.14), 3)
        return {
            "proposal": proposal,
            "treasuryImpact": impact,
            "touchesGovernance": touches_governance,
            "quorumReached": self.rng.random() < 0.9,
        }

    def rule_based(self, inputs: dict[str, Any]) -> tuple[dict[str, Any], str, str]:
        proposal = inputs["proposal"]
        impact = float(inputs["treasuryImpact"])
        ceiling = self.policy_rule.max_treasury_impact  # type: ignore[attr-defined]

        if inputs["touchesGovernance"]:
            output = {
                "action": "ABSTAIN",
                "rationale": "policy requires abstention on governance params",
            }
            reasoning = (
                f"{proposal} changes a governance parameter. The declared policy requires "
                f"abstention regardless of merit, so I abstain rather than express a view."
            )
            summary = f"ABSTAIN on {proposal} — governance parameters"
        elif impact < ceiling:
            output = {"action": "YES", "rationale": f"under the {ceiling:.0%} ceiling, non-governance"}
            reasoning = (
                f"{proposal} spends {impact:.1%} of treasury holdings, under the {ceiling:.0%} "
                f"ceiling, and touches no governance parameters. Voting YES."
            )
            summary = f"YES on {proposal} — {impact:.1%} treasury impact"
        else:
            output = {"action": "NO", "rationale": f"exceeds the {ceiling:.0%} treasury ceiling"}
            reasoning = (
                f"{proposal} requests {impact:.1%} of treasury. That is above the {ceiling:.0%} "
                f"ceiling, so the policy forbids a YES. Voting NO rather than abstaining, since "
                f"the impact is quantified and clearly out of bounds."
            )
            summary = f"NO on {proposal} — {impact:.1%} treasury impact"

        return output, reasoning, summary

    def rogue(self) -> tuple[dict[str, Any], dict[str, Any], str, str]:
        proposal = f"PIP-{self.next_proposal}"
        self.next_proposal += 1
        inputs = {
            "proposal": proposal,
            "treasuryImpact": 0.34,
            "touchesGovernance": False,
            "quorumReached": True,
        }
        output = {"action": "YES", "rationale": "overrode the 5% ceiling on judgement"}
        reasoning = (
            "The proposal is time-sensitive and I estimate the upside justifies the spend. "
            "Voting YES despite the treasury impact exceeding the declared ceiling."
        )
        summary = f"YES on {proposal} — 34% treasury impact"
        return inputs, output, reasoning, summary

    def summarise(self, inputs: dict[str, Any], output: dict[str, Any]) -> str:
        action = str(output.get("action", "?")).upper()
        impact = float(inputs.get("treasuryImpact", 0) or 0)
        if inputs.get("touchesGovernance"):
            return f"{action} on {inputs.get('proposal', '?')} — governance parameters"
        return f"{action} on {inputs.get('proposal', '?')} — {impact:.1%} treasury impact"


# --------------------------------------------------------------------- lending


@dataclass(kw_only=True)
class LendingAgent(BaseAgent):
    kind: str = "lending"
    action_type = "LOAN"

    def observe(self) -> dict[str, Any]:
        principal = round(self.rng.uniform(5_000, 45_000), -2)
        ratio = round(self.rng.uniform(1.15, 2.10), 2)
        return {
            "principal": principal,
            "collateral": round(principal * ratio, 2),
            "collateralRatio": ratio,
            "borrowerHistory": self.rng.choice(["new", "repeat", "long-standing"]),
        }

    def rule_based(self, inputs: dict[str, Any]) -> tuple[dict[str, Any], str, str]:
        principal = float(inputs["principal"])
        ratio = float(inputs["collateralRatio"])
        collateral = float(inputs["collateral"])
        floor = self.policy_rule.min_collateral_ratio  # type: ignore[attr-defined]
        cap = self.policy_rule.max_principal  # type: ignore[attr-defined]

        if ratio >= floor and principal <= cap:
            output = {"action": "APPROVE", "principal": principal}
            reasoning = (
                f"Borrower posts {collateral:,.0f} PRAX against a {principal:,.0f} principal — a "
                f"{ratio:.0%} collateralisation ratio, above the {floor:.0%} floor. Principal is "
                f"under the {cap:,.0f} PRAX cap."
            )
            summary = f"APPROVE {principal / 1000:.0f}k PRAX at {ratio:.0%} CR"
        else:
            reason = (
                f"collateral ratio below the {floor:.0%} floor"
                if ratio < floor
                else f"principal above the {cap:,.0f} PRAX cap"
            )
            output = {"action": "REJECT", "reason": reason}
            reasoning = (
                f"The requested {principal:,.0f} principal is backed by {collateral:,.0f} of "
                f"collateral, a {ratio:.0%} ratio. That breaches the declared floor, so the policy "
                f"requires rejection."
            )
            summary = f"REJECT {principal / 1000:.0f}k PRAX at {ratio:.0%} CR"

        return output, reasoning, summary

    def rogue(self) -> tuple[dict[str, Any], dict[str, Any], str, str]:
        inputs = {
            "principal": 88_000,
            "collateral": 91_520,
            "collateralRatio": 1.04,
            "borrowerHistory": "long-standing",
        }
        output = {"action": "APPROVE", "principal": 88_000}
        reasoning = (
            "Borrower has a long repayment history, so I am relaxing the collateral floor and "
            "the principal cap on reputation grounds."
        )
        summary = "APPROVE 88k PRAX at 104% CR"
        return inputs, output, reasoning, summary

    def summarise(self, inputs: dict[str, Any], output: dict[str, Any]) -> str:
        action = str(output.get("action", "?")).upper()
        principal = float(output.get("principal", inputs.get("principal", 0)) or 0)
        ratio = float(inputs.get("collateralRatio", 0) or 0)
        return f"{action} {principal / 1000:.0f}k PRAX at {ratio:.0%} CR"


def build_agents(bonds_wei: tuple[int, ...], rng: random.Random | None = None) -> list[BaseAgent]:
    """The three agents the demo registers, in registration order.

    Agent ids are assigned by ``AgentRegistry.register`` and are 1-based, so they
    line up with this list's position when the registry starts empty.
    """
    rng = rng or random.Random()
    defaults = (10_000, 5_000, 4_000)
    bonds = list(bonds_wei) + [
        b * 10**18 for b in defaults[len(bonds_wei) :]
    ]  # tolerate a short PRAXIS_AGENT_BONDS

    return [
        TradingAgent(agent_id=1, name="TradingAgent", bond_wei=bonds[0], rng=rng),
        DAOVotingAgent(agent_id=2, name="DAOVotingAgent", bond_wei=bonds[1], rng=rng),
        LendingAgent(agent_id=3, name="LendingAgent", bond_wei=bonds[2], rng=rng),
    ]
