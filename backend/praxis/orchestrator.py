"""
The orchestrator: the loop that makes the whole thing move.

Every tick it picks the next active agent, asks it to decide, commits
``keccak256(trail)`` to the ledger, and files the trail off-chain. Then the
watcher reads the decision back and, if it breaches the declared policy, stakes a
fee and opens a dispute. The arbiter resolves it. That is the entire protocol
loop, and it is the same code whether the ledger is Polygon Amoy or the
simulation in ``ledger.py``.

Three things are worth knowing about the design:

*The watcher is not told about rogue mode.*
    It re-derives the violation from the committed decision alone. So the amber
    card on the dashboard is a detection, not a flag someone set.

*The chain is the source of truth for money and counts.*
    Bond, locked bond, slash count, dispute state and reputation are read back
    from the ledger on every snapshot rather than tracked here. The orchestrator
    only holds what the chain does not: the feed order, which decisions the
    watcher flagged, reputation history, and the transaction hashes.

*Ledger calls happen off the event loop.*
    They are synchronous and, against a real RPC, slow. Every one goes through
    ``asyncio.to_thread`` so a pending transaction never blocks the API.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from dataclasses import dataclass, field

from .agents import BaseAgent, Decision, build_agents
from .canonical import hash_trail
from .config import Settings
from .ledger import Ledger, LedgerError
from .llm import Brain
from .models import (
    Agent,
    Attestation,
    DecisionTrail,
    Dispute,
    ReputationPoint,
    SystemStatus,
)
from .policy import PolicyWatcher
from .reputation import tier_of
from .store import TrailStore
from .units import format_prax

__all__ = ["Orchestrator"]

log = logging.getLogger("praxis.orchestrator")

MAX_FEED = 60
MAX_HISTORY = 40


@dataclass
class _AttestationRecord:
    """What the orchestrator knows that the ledger doesn't."""

    attestation_id: int
    agent_id: int
    agent_name: str
    action_type: str
    summary: str
    trail_hash: str
    timestamp: int
    tx_hash: str | None
    policy_violation: bool
    violation_reason: str | None


@dataclass
class _DisputeRecord:
    dispute_id: int
    reputation_before: int
    reputation_after: int | None = None
    open_tx_hash: str | None = None
    resolve_tx_hash: str | None = None


@dataclass
class _AgentRuntime:
    agent: BaseAgent
    ledger_id: int
    policy: str
    rogue: bool = False
    history: list[ReputationPoint] = field(default_factory=list)


class Orchestrator:
    """Runs the agents and answers the dashboard's questions about them."""

    def __init__(
        self,
        *,
        settings: Settings,
        ledger: Ledger,
        store: TrailStore,
        brain: Brain,
        watcher: PolicyWatcher | None = None,
        agents: list[BaseAgent] | None = None,
        rng: random.Random | None = None,
    ):
        self._settings = settings
        self._ledger = ledger
        self._store = store
        self._brain = brain
        self._watcher = watcher or PolicyWatcher()
        self._rng = rng or random.Random()
        self._seed_agents = agents or build_agents(settings.agent_bonds_wei, self._rng)

        self._runtimes: dict[int, _AgentRuntime] = {}
        self._feed: list[_AttestationRecord] = []
        self._disputes: dict[int, _DisputeRecord] = {}
        self._dispute_order: list[int] = []

        self._cycle = 0
        self._nonce_counter = 0
        self._tasks: set[asyncio.Task] = set()
        self._tick_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._started = False

    # ------------------------------------------------------------- lifecycle

    async def start(self) -> None:
        """Registers the agents, seeds the feed and starts ticking."""
        if self._started:
            return
        self._started = True

        await self._brain.probe()
        await self._register_agents()

        for _ in range(max(0, self._settings.seed_attestations)):
            await self._tick()

        self._tick_task = asyncio.create_task(self._run(), name="praxis-tick")
        log.info(
            "orchestrator started: %d agents, tick every %.1fs",
            len(self._runtimes),
            self._settings.tick_seconds,
        )

    async def stop(self) -> None:
        self._started = False
        if self._tick_task:
            self._tick_task.cancel()
            await asyncio.gather(self._tick_task, return_exceptions=True)
            self._tick_task = None
        for task in list(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    async def _run(self) -> None:
        while True:
            try:
                await asyncio.sleep(self._settings.tick_seconds)
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - one bad tick must not stop the loop
                log.exception("tick failed")

    def _spawn(self, coro) -> None:
        """Fire-and-forget, but tracked so ``stop`` can cancel it."""
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # ------------------------------------------------------------ registration

    async def _register_agents(self) -> None:
        """Registers each agent, reusing an on-chain identity where one exists.

        Re-registering on every restart would mint a new agent id and post a
        fresh bond each time, so an existing registration under the same name is
        adopted instead.
        """
        existing = await self._existing_by_name()

        for agent in self._seed_agents:
            found = existing.get(agent.name)
            if found is not None:
                ledger_agent = await self._call(self._ledger.agent, found)
                policy = ledger_agent.metadata_uri or agent.policy
                self._runtimes[agent.agent_id] = _AgentRuntime(
                    agent=agent, ledger_id=found, policy=policy
                )
                log.info("adopted existing agent %s (ledger id %d)", agent.name, found)
                continue

            receipt = await self._call(
                self._ledger.register,
                owner_hint="",
                name=agent.name,
                metadata_uri=agent.policy,
                bond_wei=agent.bond_wei,
            )
            self._runtimes[agent.agent_id] = _AgentRuntime(
                agent=agent, ledger_id=receipt.id, policy=agent.policy
            )
            log.info(
                "registered %s as ledger id %d with %s PRAX bonded",
                agent.name,
                receipt.id,
                format_prax(agent.bond_wei),
            )

        for runtime in self._runtimes.values():
            await self._record_score(runtime)

    async def _existing_by_name(self) -> dict[str, int]:
        """Ledger ids of already-registered agents, keyed by name."""
        try:
            ids = await self._call(self._ledger.agent_ids_of_owner)
        except LedgerError as error:
            log.warning("could not list existing agents (%s); registering fresh", error)
            return {}

        found: dict[str, int] = {}
        for agent_id in ids:
            try:
                found[(await self._call(self._ledger.agent, agent_id)).name] = agent_id
            except LedgerError:
                continue
        return found

    # ------------------------------------------------------------------ ticks

    async def _tick(self) -> None:
        """One compliant-intent decision from the next agent in rotation."""
        active = [r for r in self._runtimes.values() if await self._is_active(r)]
        if not active:
            return
        runtime = active[self._cycle % len(active)]
        self._cycle += 1

        decision = await runtime.agent.decide(self._brain)
        await self._commit(runtime, decision)

    async def _is_active(self, runtime: _AgentRuntime) -> bool:
        try:
            return (await self._call(self._ledger.agent, runtime.ledger_id)).active
        except LedgerError:
            return False

    async def _commit(self, runtime: _AgentRuntime, decision: Decision) -> _AttestationRecord:
        """Hashes the trail, commits the digest, stores the trail, then watches it.

        The attestation id is part of the hashed body, so it has to be known
        before the hash exists — and only the ledger assigns it. The id is
        therefore read first and the body hashed against it, which makes the
        read-then-write a critical section: two decisions racing here would both
        hash against the same id and one of them would commit a digest for an
        attestation it does not belong to. The lock closes that window for every
        writer in this process.
        """
        async with self._lock:
            self._nonce_counter += 1
            nonce = f"{int(time.time() * 1000)}-{self._nonce_counter}"
            attestation_id = await self._call(self._ledger.next_attestation_id)

            body = {
                "attestationId": attestation_id,
                "agentId": runtime.ledger_id,
                "policy": runtime.policy,
                "inputs": decision.inputs,
                "reasoning": decision.reasoning,
                "output": decision.output,
                "nonce": nonce,
            }
            trail_hash = hash_trail(body)

            receipt = await self._call(
                self._ledger.attest,
                agent_id=runtime.ledger_id,
                trail_hash=trail_hash,
                action_type=decision.action_type,
                summary=decision.summary,
            )

        if receipt.id != attestation_id:
            # Only reachable against a real chain, where someone else can take
            # the id between the read and the transaction. The body is stored
            # exactly as committed rather than re-hashed against the new id:
            # re-hashing would produce a digest the chain never recorded, and
            # the dashboard would then report a mismatch on an honest trail.
            # The trail's own attestationId is left disagreeing with its ledger
            # id, which is the truth about what was committed.
            log.error(
                "attestation id shifted %d -> %d; the committed trail names the old id. "
                "Another writer is using this agent's key.",
                attestation_id,
                receipt.id,
            )

        self._store.put(
            attestation_id=receipt.id,
            agent_id=runtime.ledger_id,
            body=body,
            trail_hash=trail_hash,
            source=decision.source,
            model=decision.model,
            created_at=receipt.timestamp,
        )

        # The watcher gets the decision the same way anyone else would: from the
        # committed record, with no hint about how it was produced.
        violation = self._watcher.inspect(runtime.agent.kind, decision.inputs, decision.output)

        record = _AttestationRecord(
            attestation_id=receipt.id,
            agent_id=runtime.ledger_id,
            agent_name=runtime.agent.name,
            action_type=decision.action_type,
            summary=decision.summary,
            trail_hash=trail_hash,
            timestamp=receipt.timestamp,
            tx_hash=receipt.tx_hash,
            policy_violation=violation is not None,
            violation_reason=violation,
        )
        self._feed.insert(0, record)
        del self._feed[MAX_FEED:]

        await self._record_score(runtime)

        if violation is not None:
            log.info(
                "watcher flagged attestation %d by %s: %s",
                record.attestation_id,
                runtime.agent.name,
                violation,
            )
            self._spawn(self._watch(record))

        return record

    # --------------------------------------------------------- watch & arbitrate

    async def _watch(self, record: _AttestationRecord) -> None:
        """Stakes a fee and opens a dispute against a flagged attestation."""
        await asyncio.sleep(self._settings.watcher_delay_seconds)

        runtime = self._runtime_for(record.agent_id)
        if runtime is None:
            return

        reputation_before = await self._call(self._ledger.reputation, record.agent_id)
        try:
            receipt = await self._call(
                self._ledger.open_dispute,
                attestation_id=record.attestation_id,
                reason=record.violation_reason or "Decision breaches the agent's declared policy.",
            )
        except LedgerError as error:
            log.warning("could not open a dispute on attestation %d: %s", record.attestation_id, error)
            return

        self._disputes[receipt.id] = _DisputeRecord(
            dispute_id=receipt.id,
            reputation_before=reputation_before,
            open_tx_hash=receipt.tx_hash,
        )
        self._dispute_order.insert(0, receipt.id)
        await self._record_score(runtime)

        log.info("dispute %d opened against attestation %d", receipt.id, record.attestation_id)

        if self._settings.auto_arbitrate:
            self._spawn(self._arbitrate(receipt.id))

    async def _arbitrate(self, dispute_id: int) -> None:
        """The arbiter's verdict, after a pause for the countdown to be visible."""
        await asyncio.sleep(self._settings.arbiter_delay_seconds)
        try:
            # The violation is provable from the revealed trail, so the arbiter
            # upholds. A manual resolution that got here first makes this a no-op.
            await self.resolve_dispute(dispute_id, upheld=True)
        except LedgerError as error:
            log.info("automatic arbitration of dispute %d skipped: %s", dispute_id, error)

    # ------------------------------------------------------------- public API

    async def trigger_rogue(self, agent_id: int) -> int:
        """Makes an agent breach its own declared policy. Returns the attestation id."""
        runtime = self._runtime_for(agent_id)
        if runtime is None:
            raise LedgerError(f"unknown agent {agent_id}")
        if not await self._is_active(runtime):
            raise LedgerError(f"{runtime.agent.name} has been slashed out and can no longer act")

        runtime.rogue = True
        record = await self._commit(runtime, runtime.agent.decide_rogue())
        return record.attestation_id

    async def resolve_dispute(self, dispute_id: int, upheld: bool) -> Dispute:
        """Arbiter verdict on an open dispute."""
        async with self._lock:
            record = self._disputes.get(dispute_id)
            if record is None:
                raise LedgerError(f"unknown dispute {dispute_id}")

            current = await self._call(self._ledger.dispute, dispute_id)
            if current.status != "open":
                raise LedgerError(f"dispute {dispute_id} is already {current.status}")

            receipt = await self._call(self._ledger.resolve, dispute_id=dispute_id, upheld=upheld)
            record.resolve_tx_hash = receipt.tx_hash

            runtime = self._runtime_for(current.agent_id)
            if runtime is not None:
                # An agent that was caught is no longer in rogue mode; whatever
                # happens next is a fresh decision.
                runtime.rogue = False
                await self._record_score(runtime)
                record.reputation_after = await self._call(self._ledger.reputation, current.agent_id)

            log.info("dispute %d resolved: %s", dispute_id, "upheld" if upheld else "rejected")
            return await self.dispute(dispute_id)

    async def reset(self) -> None:
        """Puts the simulation back to its opening state.

        Only meaningful without a chain — a slash on Amoy is not reversible, so
        this refuses rather than pretending.
        """
        if (await self._call(self._ledger.info)).mode != "simulated":
            raise LedgerError("reset is only available in simulated mode")

        await self.stop()
        rebuild = getattr(self._ledger, "reset", None)
        if rebuild is not None:
            rebuild()

        self._store.clear()
        self._runtimes.clear()
        self._feed.clear()
        self._disputes.clear()
        self._dispute_order.clear()
        self._cycle = 0
        self._nonce_counter = 0
        self._seed_agents = build_agents(self._settings.agent_bonds_wei, self._rng)
        await self.start()

    # ------------------------------------------------------------- snapshots

    async def status(self) -> SystemStatus:
        info = await self._call(self._ledger.info)
        return SystemStatus(
            # Always "live". The dashboard uses this field to mean "is a real
            # orchestrator answering, or is the browser simulating one itself" —
            # its demo copy literally reads "the dashboard is driving itself
            # from an in-browser simulation", which is false whenever this
            # response exists at all. Whether a *chain* is attached is carried
            # by `contracts`, `network` and `chainId`: without a deployment they
            # are null / "simulation" / 0, and the panel correctly reports no
            # deployment recorded.
            mode="live",
            network=info.network,
            chainId=info.chain_id,
            explorerUrl=info.explorer_url,
            contracts=info.contracts,
            ollamaAvailable=self._brain.available,
            challengeWindowSeconds=info.challenge_window_seconds,
            slashBps=info.slash_bps,
            minBond=format_prax(info.min_bond_wei),
            blockNumber=info.block_number,
        )

    async def agents(self) -> list[Agent]:
        out: list[Agent] = []
        for runtime in self._runtimes.values():
            state = await self._call(self._ledger.agent, runtime.ledger_id)
            score = await self._call(self._ledger.reputation, runtime.ledger_id)

            # Status is the agent's CURRENT standing, matching AgentRegistry:
            # only a bond that has fallen under minBond takes an agent out of
            # the system. Past slashes are history — they show in slashCount,
            # the reputation penalty and the trend — and must not zombify an
            # agent that is still bonded and still allowed to act. The states
            # are documented in frontend/src/lib/types.ts.
            if not state.active:
                status = "slashed"
            elif state.open_disputes > 0:
                status = "disputed"
            else:
                status = "active"

            out.append(
                Agent(
                    agentId=runtime.ledger_id,
                    name=runtime.agent.name,
                    kind=runtime.agent.kind,  # type: ignore[arg-type]
                    policy=runtime.policy,
                    owner=state.owner,
                    bond=format_prax(state.bond_wei),
                    lockedBond=format_prax(state.locked_bond_wei),
                    reputation=score,
                    tier=tier_of(score),  # type: ignore[arg-type]
                    status=status,  # type: ignore[arg-type]
                    reputationHistory=list(runtime.history),
                    attestationCount=state.total_attestations,
                    cleanAttestationCount=state.clean_attestations,
                    slashCount=state.slash_count,
                    rogue=runtime.rogue,
                    registeredAt=state.registered_at,
                    llmBacked=self._brain.available,
                )
            )
        return out

    async def attestations(self, limit: int = 40) -> list[Attestation]:
        out: list[Attestation] = []
        for record in self._feed[: max(0, limit)]:
            try:
                state = await self._call(self._ledger.attestation, record.attestation_id)
                disputed, slashed = state.disputed, state.slashed
            except LedgerError:
                disputed = slashed = False

            out.append(
                Attestation(
                    attestationId=record.attestation_id,
                    agentId=record.agent_id,
                    agentName=record.agent_name,
                    actionType=record.action_type,  # type: ignore[arg-type]
                    summary=record.summary,
                    trailHash=record.trail_hash,
                    timestamp=record.timestamp,
                    txHash=record.tx_hash,
                    disputed=disputed,
                    slashed=slashed,
                    policyViolation=record.policy_violation,
                )
            )
        return out

    def trail(self, attestation_id: int) -> DecisionTrail | None:
        return self._store.get(attestation_id)

    async def disputes(self) -> list[Dispute]:
        return [await self.dispute(dispute_id) for dispute_id in self._dispute_order]

    async def dispute(self, dispute_id: int) -> Dispute:
        record = self._disputes.get(dispute_id)
        if record is None:
            raise LedgerError(f"unknown dispute {dispute_id}")

        state = await self._call(self._ledger.dispute, dispute_id)
        runtime = self._runtime_for(state.agent_id)

        return Dispute(
            disputeId=state.dispute_id,
            attestationId=state.attestation_id,
            agentId=state.agent_id,
            agentName=runtime.agent.name if runtime else f"agent {state.agent_id}",
            challenger=state.challenger,
            reason=state.reason,
            fee=format_prax(state.fee_wei),
            status=state.status,
            openedAt=state.opened_at,
            resolvedAt=state.resolved_at,
            bondBefore=format_prax(state.bond_before_wei),
            bondAfter=format_prax(state.bond_after_wei) if state.bond_after_wei is not None else None,
            slashedAmount=format_prax(state.slashed_wei) if state.slashed_wei is not None else None,
            challengerPayout=(
                format_prax(state.challenger_payout_wei)
                if state.challenger_payout_wei is not None
                else None
            ),
            reputationBefore=record.reputation_before,
            reputationAfter=record.reputation_after,
            openTxHash=record.open_tx_hash,
            resolveTxHash=record.resolve_tx_hash,
        )

    # ---------------------------------------------------------------- helpers

    def _runtime_for(self, ledger_id: int) -> _AgentRuntime | None:
        for runtime in self._runtimes.values():
            if runtime.ledger_id == ledger_id:
                return runtime
        return None

    async def _record_score(self, runtime: _AgentRuntime) -> None:
        """Appends a reputation sample when the number actually moved."""
        try:
            score = await self._call(self._ledger.reputation, runtime.ledger_id)
        except LedgerError:
            return
        now = int(time.time())
        if runtime.history and runtime.history[-1].score == score:
            return
        runtime.history.append(ReputationPoint(t=now, score=score))
        del runtime.history[:-MAX_HISTORY]

    @staticmethod
    async def _call(fn, *args, **kwargs):
        """Runs a synchronous ledger call off the event loop."""
        return await asyncio.to_thread(lambda: fn(*args, **kwargs))
