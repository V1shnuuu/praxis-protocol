"""
The ledger interface, and the in-process implementation of it.

Everything above this module — the agents, the watcher, the orchestrator, the
REST layer — is written against :class:`Ledger` and does not know whether it is
talking to Polygon Amoy or to the simulation in this file. That is what lets the
orchestrator run identically before and after a deployment exists, and it is why
the demo works on a laptop with no RPC endpoint and no test POL.

:class:`SimulatedLedger` is a line-by-line mirror of the contracts, not an
approximation: same wei arithmetic, same integer truncation, same
lock/slash/credit ordering, same "an agent under ``minBond`` stops being active".
The numbers a judge sees without a chain are the numbers the chain would produce.

The live implementation lives in ``chain.py``.
"""

from __future__ import annotations

import itertools
import threading
import time
from dataclasses import dataclass, field
from typing import Literal

from .reputation import ReputationInputs, compute_reputation

__all__ = [
    "LedgerInfo",
    "LedgerAgent",
    "LedgerAttestation",
    "LedgerDispute",
    "Receipt",
    "Ledger",
    "SimulatedLedger",
    "LedgerError",
    "BPS_DENOMINATOR",
]

BPS_DENOMINATOR = 10_000


class LedgerError(RuntimeError):
    """A rejected ledger operation. Mirrors a contract revert."""


@dataclass(frozen=True)
class LedgerInfo:
    mode: Literal["live", "simulated"]
    network: str
    chain_id: int
    explorer_url: str | None
    contracts: dict[str, str] | None
    block_number: int | None
    min_bond_wei: int
    challenge_fee_wei: int
    challenge_window_seconds: int
    slash_bps: int
    challenger_reward_bps: int


@dataclass(frozen=True)
class LedgerAgent:
    agent_id: int
    owner: str
    name: str
    metadata_uri: str
    bond_wei: int
    locked_bond_wei: int
    total_slashed_wei: int
    slash_count: int
    registered_at: int
    active: bool
    total_attestations: int
    clean_attestations: int
    open_disputes: int
    rejected_disputes: int


@dataclass(frozen=True)
class LedgerAttestation:
    attestation_id: int
    agent_id: int
    trail_hash: str
    action_type: str
    summary: str
    timestamp: int
    disputed: bool
    slashed: bool


@dataclass(frozen=True)
class LedgerDispute:
    dispute_id: int
    attestation_id: int
    agent_id: int
    challenger: str
    reason: str
    fee_wei: int
    status: Literal["open", "upheld", "rejected"]
    opened_at: int
    resolved_at: int | None
    bond_before_wei: int
    bond_after_wei: int | None
    slashed_wei: int | None
    challenger_payout_wei: int | None


@dataclass(frozen=True)
class Receipt:
    """What came back from a write. ``tx_hash`` is None off-chain."""

    tx_hash: str | None = None
    id: int = 0
    timestamp: int = 0


class Ledger:
    """Everything the orchestrator needs from the accountability layer."""

    def info(self) -> LedgerInfo:
        raise NotImplementedError

    def register(self, *, owner_hint: str, name: str, metadata_uri: str, bond_wei: int) -> Receipt:
        raise NotImplementedError

    def attest(self, *, agent_id: int, trail_hash: str, action_type: str, summary: str) -> Receipt:
        raise NotImplementedError

    def open_dispute(self, *, attestation_id: int, reason: str) -> Receipt:
        raise NotImplementedError

    def resolve(self, *, dispute_id: int, upheld: bool) -> Receipt:
        raise NotImplementedError

    def agent(self, agent_id: int) -> LedgerAgent:
        raise NotImplementedError

    def attestation(self, attestation_id: int) -> LedgerAttestation:
        raise NotImplementedError

    def dispute(self, dispute_id: int) -> LedgerDispute:
        raise NotImplementedError

    def reputation(self, agent_id: int) -> int:
        raise NotImplementedError

    def next_attestation_id(self) -> int:
        """The id the next :meth:`attest` will assign.

        The orchestrator needs it before it can hash a trail body, because the
        attestation id is part of the commitment.
        """
        raise NotImplementedError

    def agent_ids_of_owner(self) -> list[int]:
        """Agents already registered to the signing identity.

        Lets a restart adopt its agents instead of registering duplicates and
        posting a second bond.
        """
        raise NotImplementedError

    def challenger_address(self) -> str:
        """Address the watcher stakes from — shown on the dispute card."""
        raise NotImplementedError

    def close(self) -> None:
        return None


# ---------------------------------------------------------------------------


@dataclass
class _Agent:
    agent_id: int
    owner: str
    name: str
    metadata_uri: str
    bond: int
    locked_bond: int = 0
    total_slashed: int = 0
    slash_count: int = 0
    registered_at: int = 0
    active: bool = True
    attestation_ids: list[int] = field(default_factory=list)
    slashed_attestations: int = 0
    open_disputes: int = 0
    upheld_disputes: int = 0
    rejected_disputes: int = 0


@dataclass
class _Attestation:
    attestation_id: int
    agent_id: int
    trail_hash: str
    action_type: str
    summary: str
    timestamp: int
    disputed: bool = False
    slashed: bool = False


@dataclass
class _Dispute:
    dispute_id: int
    attestation_id: int
    agent_id: int
    challenger: str
    reason: str
    fee: int
    locked_amount: int
    bond_before: int
    opened_at: int
    status: str = "open"
    resolved_at: int | None = None
    bond_after: int | None = None
    slashed_amount: int | None = None
    challenger_payout: int | None = None


class SimulatedLedger(Ledger):
    """The contracts, in Python, in this process.

    Deliberately not a "close enough" mock: the demo's credibility rests on the
    numbers matching what Amoy would produce, so the arithmetic here is copied
    from the Solidity rather than reinvented.
    """

    # Deterministic stand-ins for the wallets scripts/new-wallets.js generates.
    # They are Hardhat's well-known accounts, so an address on the dashboard in
    # simulated mode is recognisably a test address and not a real one.
    ARBITER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
    AGENT_OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
    CHALLENGER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

    def __init__(
        self,
        *,
        min_bond_wei: int,
        challenge_fee_wei: int,
        challenge_window_seconds: int,
        slash_bps: int,
        challenger_reward_bps: int,
        clock=time.time,
    ):
        self._min_bond = min_bond_wei
        self._challenge_fee = challenge_fee_wei
        self._challenge_window = challenge_window_seconds
        self._slash_bps = slash_bps
        self._challenger_reward_bps = challenger_reward_bps
        self._clock = clock

        self._agents: dict[int, _Agent] = {}
        self._attestations: dict[int, _Attestation] = {}
        self._disputes: dict[int, _Dispute] = {}
        self._open_dispute_of: dict[int, int] = {}

        self._agent_ids = itertools.count(1)
        self._attestation_ids = itertools.count(1)
        self._dispute_ids = itertools.count(1)
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ info

    def _now(self) -> int:
        return int(self._clock())

    def info(self) -> LedgerInfo:
        return LedgerInfo(
            mode="simulated",
            network="simulation",
            chain_id=0,
            explorer_url=None,
            contracts=None,
            block_number=None,
            min_bond_wei=self._min_bond,
            challenge_fee_wei=self._challenge_fee,
            challenge_window_seconds=self._challenge_window,
            slash_bps=self._slash_bps,
            challenger_reward_bps=self._challenger_reward_bps,
        )

    def challenger_address(self) -> str:
        return self.CHALLENGER

    def next_attestation_id(self) -> int:
        """The id the next ``attest`` will assign.

        The orchestrator needs it before it can hash the trail body, because the
        attestation id is part of the commitment.
        """
        with self._lock:
            return len(self._attestations) + 1

    def agent_ids_of_owner(self) -> list[int]:
        """No persistence off-chain, so a restart always starts empty."""
        return []

    def reset(self) -> None:
        """Clears every agent, attestation and dispute. Simulation only."""
        with self._lock:
            self._agents.clear()
            self._attestations.clear()
            self._disputes.clear()
            self._open_dispute_of.clear()
            self._agent_ids = itertools.count(1)
            self._attestation_ids = itertools.count(1)
            self._dispute_ids = itertools.count(1)

    # ----------------------------------------------------------------- writes

    def register(self, *, owner_hint: str, name: str, metadata_uri: str, bond_wei: int) -> Receipt:
        """Mirror of ``AgentRegistry.register``."""
        if bond_wei < self._min_bond:
            raise LedgerError(f"bond {bond_wei} is below the minimum {self._min_bond}")

        with self._lock:
            agent_id = next(self._agent_ids)
            now = self._now()
            self._agents[agent_id] = _Agent(
                agent_id=agent_id,
                owner=owner_hint or self.AGENT_OWNER,
                name=name,
                metadata_uri=metadata_uri,
                bond=bond_wei,
                registered_at=now,
            )
            return Receipt(tx_hash=None, id=agent_id, timestamp=now)

    def attest(self, *, agent_id: int, trail_hash: str, action_type: str, summary: str) -> Receipt:
        """Mirror of ``ActionAttestation.attest``."""
        with self._lock:
            agent = self._require_agent(agent_id)
            if not agent.active:
                raise LedgerError(f"agent {agent_id} is not active and cannot attest")

            attestation_id = next(self._attestation_ids)
            now = self._now()
            self._attestations[attestation_id] = _Attestation(
                attestation_id=attestation_id,
                agent_id=agent_id,
                trail_hash=trail_hash,
                action_type=action_type,
                summary=summary,
                timestamp=now,
            )
            agent.attestation_ids.append(attestation_id)
            return Receipt(tx_hash=None, id=attestation_id, timestamp=now)

    def open_dispute(self, *, attestation_id: int, reason: str) -> Receipt:
        """Mirror of ``DisputeSlashing.openDispute``."""
        with self._lock:
            attestation = self._require_attestation(attestation_id)

            existing = self._open_dispute_of.get(attestation_id)
            if existing:
                raise LedgerError(f"attestation {attestation_id} already has open dispute {existing}")

            now = self._now()
            deadline = attestation.timestamp + self._challenge_window
            if now > deadline:
                raise LedgerError(
                    f"challenge window for attestation {attestation_id} closed at {deadline}"
                )

            agent = self._require_agent(attestation.agent_id)
            dispute_id = next(self._dispute_ids)
            lock_amount = (agent.bond * self._slash_bps) // BPS_DENOMINATOR

            self._disputes[dispute_id] = _Dispute(
                dispute_id=dispute_id,
                attestation_id=attestation_id,
                agent_id=agent.agent_id,
                challenger=self.CHALLENGER,
                reason=reason,
                fee=self._challenge_fee,
                locked_amount=lock_amount,
                bond_before=agent.bond,
                opened_at=now,
            )
            self._open_dispute_of[attestation_id] = dispute_id
            agent.open_disputes += 1

            # lockBond clamps to the free (unlocked) portion of the bond.
            free = agent.bond - agent.locked_bond
            agent.locked_bond += min(lock_amount, free)
            attestation.disputed = True

            return Receipt(tx_hash=None, id=dispute_id, timestamp=now)

    def resolve(self, *, dispute_id: int, upheld: bool) -> Receipt:
        """Mirror of ``DisputeSlashing.resolve``."""
        with self._lock:
            dispute = self._disputes.get(dispute_id)
            if dispute is None:
                raise LedgerError(f"unknown dispute {dispute_id}")
            if dispute.status != "open":
                raise LedgerError(f"dispute {dispute_id} is not open")

            agent = self._require_agent(dispute.agent_id)
            attestation = self._require_attestation(dispute.attestation_id)
            bond_before = agent.bond
            dispute.bond_before = bond_before

            # Release this dispute's reservation before touching the bond.
            agent.locked_bond -= min(dispute.locked_amount, agent.locked_bond)

            slashed = 0
            payout = 0

            if upheld:
                dispute.status = "upheld"
                agent.upheld_disputes += 1

                slashed = (agent.bond * self._slash_bps) // BPS_DENOMINATOR
                agent.bond -= slashed
                agent.total_slashed += slashed
                agent.slash_count += 1
                if agent.locked_bond > agent.bond:
                    agent.locked_bond = agent.bond
                if agent.bond < self._min_bond:
                    agent.active = False

                reward = (slashed * self._challenger_reward_bps) // BPS_DENOMINATOR
                payout = reward + dispute.fee  # the fee is returned on a successful challenge
            else:
                dispute.status = "rejected"
                agent.rejected_disputes += 1
                # The forfeited fee compensates the agent for the false accusation.
                agent.bond += dispute.fee

            agent.open_disputes -= 1
            self._open_dispute_of.pop(dispute.attestation_id, None)

            now = self._now()
            dispute.resolved_at = now
            dispute.slashed_amount = slashed
            dispute.challenger_payout = payout
            dispute.bond_after = agent.bond

            attestation.disputed = False
            if upheld and not attestation.slashed:
                attestation.slashed = True
                agent.slashed_attestations += 1

            return Receipt(tx_hash=None, id=dispute_id, timestamp=now)

    # ------------------------------------------------------------------ reads

    def agent(self, agent_id: int) -> LedgerAgent:
        with self._lock:
            a = self._require_agent(agent_id)
            total = len(a.attestation_ids)
            return LedgerAgent(
                agent_id=a.agent_id,
                owner=a.owner,
                name=a.name,
                metadata_uri=a.metadata_uri,
                bond_wei=a.bond,
                locked_bond_wei=a.locked_bond,
                total_slashed_wei=a.total_slashed,
                slash_count=a.slash_count,
                registered_at=a.registered_at,
                active=a.active,
                total_attestations=total,
                # Mirrors ActionAttestation.cleanByAgent: clean means "never
                # upheld as a violation", not "never suspected of one".
                clean_attestations=max(0, total - a.slashed_attestations),
                open_disputes=a.open_disputes,
                rejected_disputes=a.rejected_disputes,
            )

    def attestation(self, attestation_id: int) -> LedgerAttestation:
        with self._lock:
            a = self._require_attestation(attestation_id)
            return LedgerAttestation(
                attestation_id=a.attestation_id,
                agent_id=a.agent_id,
                trail_hash=a.trail_hash,
                action_type=a.action_type,
                summary=a.summary,
                timestamp=a.timestamp,
                disputed=a.disputed,
                slashed=a.slashed,
            )

    def dispute(self, dispute_id: int) -> LedgerDispute:
        with self._lock:
            d = self._disputes.get(dispute_id)
            if d is None:
                raise LedgerError(f"unknown dispute {dispute_id}")
            return LedgerDispute(
                dispute_id=d.dispute_id,
                attestation_id=d.attestation_id,
                agent_id=d.agent_id,
                challenger=d.challenger,
                reason=d.reason,
                fee_wei=d.fee,
                status=d.status,  # type: ignore[arg-type]
                opened_at=d.opened_at,
                resolved_at=d.resolved_at,
                bond_before_wei=d.bond_before,
                bond_after_wei=d.bond_after,
                slashed_wei=d.slashed_amount,
                challenger_payout_wei=d.challenger_payout,
            )

    def reputation(self, agent_id: int) -> int:
        """Mirror of ``ReputationScore.scoreOf``."""
        a = self.agent(agent_id)
        return compute_reputation(
            ReputationInputs(
                active=a.active,
                bond_wei=a.bond_wei,
                min_bond_wei=self._min_bond,
                total_slashed_wei=a.total_slashed_wei,
                slash_count=a.slash_count,
                clean_attestations=a.clean_attestations,
                registered_at=a.registered_at,
                open_disputes=a.open_disputes,
                defended_disputes=a.rejected_disputes,
                now=self._now(),
            )
        ).score

    # ---------------------------------------------------------------- helpers

    def _require_agent(self, agent_id: int) -> _Agent:
        agent = self._agents.get(agent_id)
        if agent is None:
            raise LedgerError(f"unknown agent {agent_id}")
        return agent

    def _require_attestation(self, attestation_id: int) -> _Attestation:
        attestation = self._attestations.get(attestation_id)
        if attestation is None:
            raise LedgerError(f"unknown attestation {attestation_id}")
        return attestation
