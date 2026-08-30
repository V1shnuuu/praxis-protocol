"""
Runtime configuration, read once from the environment.

The orchestrator has to run in two quite different situations, and the settings
below are what separate them:

*live*
    A deployed stack exists (``deployed-addresses.json``), an RPC endpoint is
    reachable and signing keys are configured. Attestations, disputes and
    resolutions are real transactions.

*simulated*
    No deployment yet. The same orchestrator runs against an in-process ledger
    that mirrors the contract arithmetic, so the agents, the trails, the hashes
    and the REST surface are all exercised for real — only the chain is stubbed.

``PRAXIS_MODE=auto`` (the default) picks live when a deployment is readable and
falls back to simulated when it is not, which is what makes ``uvicorn`` work
straight after ``git clone``.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from .units import parse_prax

__all__ = ["Settings", "load_settings", "REPO_ROOT"]

REPO_ROOT = Path(__file__).resolve().parents[2]


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    return int(raw) if raw else default


def _env_float(name: str, default: float) -> float:
    raw = _env(name)
    return float(raw) if raw else default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name).lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = _env(name)
    return [item.strip() for item in raw.split(",") if item.strip()] if raw else default


@dataclass(frozen=True)
class Settings:
    # --- chain wiring -------------------------------------------------------
    mode: str  # "auto" | "live" | "simulated"
    network: str
    rpc_url: str
    deployment_file: Path
    abi_dir: Path
    arbiter_key: str
    agent_key: str
    challenger_key: str

    # --- economics (used by the simulated ledger; the chain is authoritative
    #     when one is attached) -------------------------------------------------
    min_bond_wei: int
    challenge_fee_wei: int
    challenge_window_seconds: int
    slash_bps: int
    challenger_reward_bps: int
    agent_bonds_wei: tuple[int, ...]

    # --- orchestration ------------------------------------------------------
    tick_seconds: float
    watcher_delay_seconds: float
    arbiter_delay_seconds: float
    auto_arbitrate: bool
    seed_attestations: int
    autostart: bool

    # --- the brain ----------------------------------------------------------
    ollama_url: str
    ollama_model: str
    ollama_timeout_seconds: float
    llm_enabled: bool

    # --- plumbing -----------------------------------------------------------
    db_path: Path
    cors_origins: list[str] = field(default_factory=list)

    def deployment(self) -> dict | None:
        """The address-book record for ``network``, or None when there isn't one."""
        if not self.deployment_file.exists():
            return None
        try:
            book = json.loads(self.deployment_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        record = book.get(self.network)
        return record if isinstance(record, dict) else None

    @property
    def has_signing_keys(self) -> bool:
        return bool(self.arbiter_key and self.agent_key and self.challenger_key)


def load_settings() -> Settings:
    """Reads settings from the environment. Called once at application start."""
    return Settings(
        mode=_env("PRAXIS_MODE", "auto").lower(),
        network=_env("PRAXIS_NETWORK", "amoy"),
        rpc_url=_env("PRAXIS_RPC_URL", "https://rpc-amoy.polygon.technology"),
        deployment_file=Path(
            _env("PRAXIS_DEPLOYMENT_FILE", str(REPO_ROOT / "deployed-addresses.json"))
        ),
        abi_dir=Path(_env("PRAXIS_ABI_DIR", str(REPO_ROOT / "deployments" / "abis"))),
        arbiter_key=_env("ARBITER_PRIVATE_KEY"),
        agent_key=_env("AGENT_PRIVATE_KEY"),
        challenger_key=_env("CHALLENGER_PRIVATE_KEY"),
        min_bond_wei=parse_prax(_env("MIN_BOND", "1000")),
        challenge_fee_wei=parse_prax(_env("CHALLENGE_FEE", "100")),
        challenge_window_seconds=_env_int("CHALLENGE_WINDOW_SECONDS", 300),
        slash_bps=_env_int("SLASH_BPS", 2000),
        challenger_reward_bps=_env_int("CHALLENGER_REWARD_BPS", 5000),
        agent_bonds_wei=tuple(
            parse_prax(value) for value in _env_list("PRAXIS_AGENT_BONDS", ["10000", "5000", "4000"])
        ),
        tick_seconds=_env_float("PRAXIS_TICK_SECONDS", 6.5),
        watcher_delay_seconds=_env_float("PRAXIS_WATCHER_DELAY_SECONDS", 2.6),
        arbiter_delay_seconds=_env_float("PRAXIS_ARBITER_DELAY_SECONDS", 4.2),
        auto_arbitrate=_env_bool("PRAXIS_AUTO_ARBITRATE", True),
        seed_attestations=_env_int("PRAXIS_SEED_ATTESTATIONS", 5),
        autostart=_env_bool("PRAXIS_AUTOSTART", True),
        ollama_url=_env("OLLAMA_URL", "http://127.0.0.1:11434"),
        ollama_model=_env("OLLAMA_MODEL", "gemma3"),
        ollama_timeout_seconds=_env_float("OLLAMA_TIMEOUT_SECONDS", 20.0),
        llm_enabled=_env_bool("PRAXIS_LLM_ENABLED", True),
        db_path=Path(_env("PRAXIS_DB_PATH", str(Path(__file__).resolve().parent.parent / "praxis.db"))),
        cors_origins=_env_list("PRAXIS_CORS_ORIGINS", ["http://localhost:3000", "http://127.0.0.1:3000"]),
    )
