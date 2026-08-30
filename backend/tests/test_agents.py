"""
The agents.

The invariant that matters: an agent's own rule must never produce a decision
that breaches its own declared policy. If it can, a "policy violation" badge on
the dashboard stops meaning anything — and the rogue button stops being a
demonstration of misbehaviour and becomes a demonstration of a bug.

The inverse invariant matters just as much: the scripted rogue decision must
always breach.
"""

from __future__ import annotations

import random

import pytest

from praxis.agents import DAOVotingAgent, LendingAgent, TradingAgent, build_agents
from praxis.llm import Answer, Brain, NullBrain
from praxis.policy import PolicyWatcher
from praxis.units import to_wei

WATCHER = PolicyWatcher()
RUNS = 200


def agent_for(kind: str, seed: int):
    rng = random.Random(seed)
    cls = {"trading": TradingAgent, "dao-voting": DAOVotingAgent, "lending": LendingAgent}[kind]
    return cls(agent_id=1, name=f"{kind}-agent", bond_wei=to_wei(10_000), rng=rng)


@pytest.mark.parametrize("kind", ["trading", "dao-voting", "lending"])
def test_the_rule_never_breaches_its_own_policy(kind):
    """Fuzzed over the whole observable range, not one happy path."""
    agent = agent_for(kind, seed=20240501)
    for _ in range(RUNS):
        inputs = agent.observe()
        output, reasoning, summary = agent.rule_based(inputs)
        violation = WATCHER.inspect(kind, inputs, output)
        assert violation is None, f"{kind} breached its own policy: {violation} ({inputs} -> {output})"
        assert reasoning and summary


@pytest.mark.parametrize("kind", ["trading", "dao-voting", "lending"])
def test_the_rogue_decision_always_breaches(kind):
    agent = agent_for(kind, seed=7)
    inputs, output, reasoning, summary = agent.rogue()
    assert WATCHER.inspect(kind, inputs, output) is not None
    assert reasoning and summary


@pytest.mark.parametrize("kind", ["trading", "dao-voting", "lending"])
async def test_decide_falls_back_to_the_rule_without_a_model(kind):
    agent = agent_for(kind, seed=3)
    decision = await agent.decide(NullBrain())
    assert decision.source == "fallback"
    assert decision.model is None
    assert WATCHER.inspect(kind, decision.inputs, decision.output) is None


@pytest.mark.parametrize("kind", ["trading", "dao-voting", "lending"])
async def test_decide_rogue_is_not_routed_through_the_model(kind):
    """The breach has to be reproducible, so it never depends on a model's mood."""
    agent = agent_for(kind, seed=3)
    decision = agent.decide_rogue()
    assert decision.source == "fallback"
    assert WATCHER.inspect(kind, decision.inputs, decision.output) is not None


class StubBrain(Brain):
    """A model that always answers, with whatever it was handed."""

    available = True
    model = "stub"

    def __init__(self, output: dict, reasoning: str = "because I said so"):
        self._answer = Answer(output=output, reasoning=reasoning, model="stub")

    async def decide(self, *, kind, policy, inputs):
        return self._answer


async def test_a_model_answer_is_recorded_as_such():
    agent = agent_for("trading", seed=1)
    decision = await agent.decide(
        StubBrain({"action": "BUY", "notional": 1000, "resultingAllocation": 0.1})
    )
    assert decision.source == "ollama"
    assert decision.model == "stub"
    assert decision.reasoning == "because I said so"


async def test_a_model_that_breaches_is_committed_not_corrected():
    """Silently fixing the model's output would hide the failure the protocol exists to expose."""
    agent = agent_for("trading", seed=1)
    decision = await agent.decide(
        StubBrain({"action": "BUY", "notional": 90_000, "resultingAllocation": 0.9})
    )
    assert decision.output["resultingAllocation"] == 0.9
    assert WATCHER.inspect("trading", decision.inputs, decision.output) is not None


@pytest.mark.parametrize("kind", ["trading", "dao-voting", "lending"])
async def test_summaries_stay_short_enough_for_the_feed(kind):
    agent = agent_for(kind, seed=11)
    for _ in range(20):
        decision = await agent.decide(NullBrain())
        assert 0 < len(decision.summary) <= 60


def test_trading_tracks_its_allocation_between_decisions():
    """A book that never moves would make the 20% cap unreachable by construction."""
    agent = agent_for("trading", seed=99)
    seen = set()
    for _ in range(60):
        inputs = agent.observe()
        agent.rule_based(inputs)
        seen.add(round(float(inputs["currentAllocation"]), 4))
    assert len(seen) > 1


def test_dao_proposals_are_not_repeated():
    agent = agent_for("dao-voting", seed=5)
    proposals = [agent.observe()["proposal"] for _ in range(30)]
    assert len(set(proposals)) == len(proposals)


def test_build_agents_returns_the_three_the_demo_registers():
    agents = build_agents((to_wei(10_000), to_wei(5_000), to_wei(4_000)), random.Random(0))
    assert [a.name for a in agents] == ["TradingAgent", "DAOVotingAgent", "LendingAgent"]
    assert [a.kind for a in agents] == ["trading", "dao-voting", "lending"]
    assert [a.agent_id for a in agents] == [1, 2, 3]
    assert [a.bond_wei for a in agents] == [to_wei(10_000), to_wei(5_000), to_wei(4_000)]


def test_build_agents_tolerates_a_short_bond_list():
    agents = build_agents((to_wei(2_000),), random.Random(0))
    assert agents[0].bond_wei == to_wei(2_000)
    assert agents[1].bond_wei == to_wei(5_000)
    assert agents[2].bond_wei == to_wei(4_000)


def test_every_agent_declares_the_policy_its_watcher_enforces():
    for agent in build_agents((to_wei(10_000),) * 3, random.Random(0)):
        assert agent.policy == agent.policy_rule.describe()


@pytest.mark.parametrize("kind", ["trading", "dao-voting", "lending"])
def test_the_rule_recovers_from_a_rogue_decision(kind):
    """Regression: going rogue must not leave the agent breaching on every later tick.

    The trading agent carries its book between decisions, so a rogue trade that
    takes ETH to 85% also leaves the *next* ordinary decision starting from 85%.
    Its rule has to unwind back inside the cap rather than keep reporting a
    breach it can no longer explain.
    """
    agent = agent_for(kind, seed=4242)
    agent.rogue()

    for step in range(30):
        inputs = agent.observe()
        output, _, _ = agent.rule_based(inputs)
        violation = WATCHER.inspect(kind, inputs, output)
        assert violation is None, f"{kind} still breaching {step} decisions after going rogue: {violation}"


def test_an_over_cap_book_is_unwound_in_one_trade():
    """The unwind has to land inside the cap immediately, not converge towards it."""
    agent = agent_for("trading", seed=1)
    agent.allocations["ETH"] = 0.85

    inputs = agent.observe()
    assert inputs["asset"] == "ETH"  # the breach is looked at first
    output, reasoning, summary = agent.rule_based(inputs)

    assert output["action"] == "SELL"
    assert output["resultingAllocation"] <= agent.policy_rule.max_allocation
    assert "unwind" in summary
    assert WATCHER.inspect("trading", inputs, output) is None
