"""Shared fixtures. Every test runs against the in-process ledger — no chain, no Ollama."""

from __future__ import annotations

import random
import sys
from dataclasses import replace
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from praxis.config import Settings  # noqa: E402
from praxis.ledger import SimulatedLedger  # noqa: E402
from praxis.store import TrailStore  # noqa: E402
from praxis.units import to_wei  # noqa: E402

#: Contract defaults, so the tests assert against the same economics the
#: deploy script uses.
MIN_BOND = to_wei(1000)
CHALLENGE_FEE = to_wei(100)
SLASH_BPS = 2000
CHALLENGER_REWARD_BPS = 5000
CHALLENGE_WINDOW = 300


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    """Fast, deterministic, offline."""
    return Settings(
        mode="simulated",
        network="simulation",
        rpc_url="",
        deployment_file=tmp_path / "deployed-addresses.json",
        abi_dir=tmp_path / "abis",
        arbiter_key="",
        agent_key="",
        challenger_key="",
        min_bond_wei=MIN_BOND,
        challenge_fee_wei=CHALLENGE_FEE,
        challenge_window_seconds=CHALLENGE_WINDOW,
        slash_bps=SLASH_BPS,
        challenger_reward_bps=CHALLENGER_REWARD_BPS,
        agent_bonds_wei=(to_wei(10_000), to_wei(5_000), to_wei(4_000)),
        tick_seconds=0.05,
        watcher_delay_seconds=0.05,
        arbiter_delay_seconds=0.05,
        auto_arbitrate=True,
        seed_attestations=3,
        autostart=False,
        ollama_url="",
        ollama_model="gemma3",
        ollama_timeout_seconds=1.0,
        llm_enabled=False,
        db_path=tmp_path / "praxis.db",
        cors_origins=[],
    )


@pytest.fixture
def manual_arbiter(settings: Settings) -> Settings:
    """Same settings, but nothing resolves a dispute unless a test asks it to."""
    return replace(settings, auto_arbitrate=False)


@pytest.fixture
def clock():
    """A hand-cranked clock, so challenge windows can be tested without waiting."""

    class Clock:
        def __init__(self, now: float = 1_700_000_000.0):
            self.now = now

        def __call__(self) -> float:
            return self.now

        def advance(self, seconds: float) -> None:
            self.now += seconds

    return Clock()


@pytest.fixture
def ledger(clock) -> SimulatedLedger:
    return SimulatedLedger(
        min_bond_wei=MIN_BOND,
        challenge_fee_wei=CHALLENGE_FEE,
        challenge_window_seconds=CHALLENGE_WINDOW,
        slash_bps=SLASH_BPS,
        challenger_reward_bps=CHALLENGER_REWARD_BPS,
        clock=clock,
    )


@pytest.fixture
def store(tmp_path: Path) -> TrailStore:
    trail_store = TrailStore(tmp_path / "trails.db")
    yield trail_store
    trail_store.close()


@pytest.fixture
def rng() -> random.Random:
    return random.Random(1337)
