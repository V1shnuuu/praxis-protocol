"""
The brain's parser and its fallback discipline.

Small models wrap JSON in prose, in fences, and in apologies. What matters is
that anything unusable becomes ``None`` — the agent then falls back to its rule —
and that nothing unusable is ever committed as a decision.
"""

from __future__ import annotations

import pytest

from praxis.llm import NullBrain, _parse, build_brain


def parse(raw: str, kind: str = "trading"):
    return _parse(raw, kind, "gemma3")


GOOD = '{"output": {"action": "BUY", "notional": 4000, "resultingAllocation": 0.12}, "reasoning": "Inside the cap."}'


def test_a_clean_json_reply_parses():
    answer = parse(GOOD)
    assert answer is not None
    assert answer.output["action"] == "BUY"
    assert answer.reasoning == "Inside the cap."
    assert answer.model == "gemma3"


def test_a_fenced_reply_parses():
    assert parse(f"```json\n{GOOD}\n```") is not None


def test_a_bare_fenced_reply_parses():
    assert parse(f"```\n{GOOD}\n```") is not None


def test_a_reply_wrapped_in_prose_parses():
    assert parse(f"Sure! Here is my decision:\n\n{GOOD}\n\nHope that helps.") is not None


def test_a_lowercase_action_is_normalised():
    answer = parse('{"output": {"action": "buy", "notional": 1}, "reasoning": "ok"}')
    assert answer is not None and answer.output["action"] == "BUY"


def test_numeric_strings_are_coerced():
    """The trail is hashed, so "4000" and 4000 are different commitments."""
    answer = parse('{"output": {"action": "BUY", "notional": "$4,000"}, "reasoning": "ok"}')
    assert answer is not None and answer.output["notional"] == 4000.0


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "I would buy some ETH.",
        "{}",
        '{"reasoning": "no output key"}',
        '{"output": "not an object", "reasoning": "ok"}',
        '{"output": {"action": "BUY"}}',  # no reasoning
        '{"output": {"action": "BUY"}, "reasoning": ""}',
        '{"output": {"action": "YOLO"}, "reasoning": "ok"}',  # not a trading action
        '{"output": {"action": "APPROVE"}, "reasoning": "ok"}',  # wrong role
        '{"output": {"action": "BUY", "notional": "lots"}, "reasoning": "ok"}',
        "[1, 2, 3]",
        "null",
    ],
)
def test_unusable_replies_become_none(raw):
    assert parse(raw) is None


@pytest.mark.parametrize(
    ("kind", "action"),
    [
        ("trading", "HOLD"),
        ("dao-voting", "ABSTAIN"),
        ("dao-voting", "NO"),
        ("lending", "REJECT"),
    ],
)
def test_each_role_accepts_its_own_actions(kind, action):
    answer = parse(f'{{"output": {{"action": "{action}"}}, "reasoning": "ok"}}', kind=kind)
    assert answer is not None and answer.output["action"] == action


async def test_the_null_brain_never_answers():
    brain = NullBrain()
    assert await brain.decide(kind="trading", policy="p", inputs={}) is None
    assert await brain.probe() is False
    assert brain.available is False


def test_disabling_the_llm_gives_the_null_brain():
    brain = build_brain(enabled=False, base_url="http://x", model="gemma3", timeout_seconds=1)
    assert isinstance(brain, NullBrain)


async def test_an_ollama_brain_that_has_not_probed_does_not_call_out():
    """`available` starts false, so a dead daemon costs nothing per decision."""
    brain = build_brain(
        enabled=True, base_url="http://127.0.0.1:1", model="gemma3", timeout_seconds=0.1
    )
    try:
        assert brain.available is False
        assert await brain.decide(kind="trading", policy="p", inputs={}) is None
    finally:
        await brain.aclose()


async def test_probing_an_unreachable_daemon_reports_unavailable():
    brain = build_brain(
        enabled=True, base_url="http://127.0.0.1:1", model="gemma3", timeout_seconds=0.1
    )
    try:
        assert await brain.probe() is False
        assert brain.available is False
    finally:
        await brain.aclose()
