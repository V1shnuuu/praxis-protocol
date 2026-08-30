"""
The REST surface the dashboard reads.

Routes are exactly the ones documented in ``frontend/src/lib/api.ts``. That file
is the contract; this one implements it. Nothing here reshapes data — the
orchestrator already produces the dashboard's own types — so the whole module is
routing, error mapping and lifecycle.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, load_settings
from .ledger import Ledger, LedgerError, SimulatedLedger
from .llm import build_brain
from .models import (
    Agent,
    Attestation,
    DecisionTrail,
    Dispute,
    ResolveRequest,
    RogueResponse,
    SystemStatus,
)
from .orchestrator import Orchestrator
from .store import TrailStore

__all__ = ["create_app", "build_ledger"]

log = logging.getLogger("praxis.api")


def build_ledger(settings: Settings) -> Ledger:
    """The ledger implied by configuration.

    ``PRAXIS_MODE=auto`` prefers a live chain and falls back to the simulation
    with a loud warning, which is what makes a fresh clone runnable. ``live``
    refuses to fall back: if you asked for a chain and there isn't one, that is
    a misconfiguration, not something to paper over.
    """
    mode = settings.mode
    if mode == "simulated":
        return _simulated(settings)

    deployment = settings.deployment()
    reason: str | None = None
    if deployment is None:
        reason = f"no deployment recorded for network {settings.network!r} in {settings.deployment_file}"
    elif not settings.has_signing_keys:
        reason = "ARBITER_PRIVATE_KEY, AGENT_PRIVATE_KEY and CHALLENGER_PRIVATE_KEY are not all set"

    if reason is None:
        from .chain import ChainLedger, ChainUnavailable

        try:
            return ChainLedger(
                rpc_url=settings.rpc_url,
                network=settings.network,
                deployment=deployment or {},
                abi_dir=settings.abi_dir,
                agent_key=settings.agent_key,
                challenger_key=settings.challenger_key,
                arbiter_key=settings.arbiter_key,
            )
        except ChainUnavailable as error:
            reason = str(error)

    if mode == "live":
        raise RuntimeError(f"PRAXIS_MODE=live but the chain is unavailable: {reason}")

    log.warning("running against the in-process ledger: %s", reason)
    return _simulated(settings)


def _simulated(settings: Settings) -> SimulatedLedger:
    return SimulatedLedger(
        min_bond_wei=settings.min_bond_wei,
        challenge_fee_wei=settings.challenge_fee_wei,
        challenge_window_seconds=settings.challenge_window_seconds,
        slash_bps=settings.slash_bps,
        challenger_reward_bps=settings.challenger_reward_bps,
    )


def create_app(
    settings: Settings | None = None,
    *,
    ledger: Ledger | None = None,
    store: TrailStore | None = None,
    autostart: bool | None = None,
) -> FastAPI:
    """Builds the application. The keyword arguments exist so tests can inject."""
    settings = settings or load_settings()
    should_start = settings.autostart if autostart is None else autostart

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.ledger = ledger or build_ledger(settings)
        app.state.store = store or TrailStore(settings.db_path)
        app.state.brain = build_brain(
            enabled=settings.llm_enabled,
            base_url=settings.ollama_url,
            model=settings.ollama_model,
            timeout_seconds=settings.ollama_timeout_seconds,
        )
        app.state.orchestrator = Orchestrator(
            settings=settings,
            ledger=app.state.ledger,
            store=app.state.store,
            brain=app.state.brain,
        )
        if should_start:
            await app.state.orchestrator.start()
        try:
            yield
        finally:
            await app.state.orchestrator.stop()
            await app.state.brain.aclose()
            app.state.ledger.close()
            app.state.store.close()

    app = FastAPI(
        title="Praxis Protocol orchestrator",
        version="0.1.0",
        summary="Runs the agents, commits their decision trails, and serves the dashboard.",
        lifespan=lifespan,
    )

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["*"],
        )

    def orchestrator() -> Orchestrator:
        return app.state.orchestrator

    # ---------------------------------------------------------------- routes

    @app.get("/api/status", response_model=SystemStatus, tags=["system"])
    async def get_status() -> SystemStatus:
        """Deployment and orchestrator health, shown in the dashboard header."""
        # Cheap enough to re-probe here, and it means the "Ollama" badge goes
        # green the moment the daemon comes up, without a restart.
        await app.state.brain.probe()
        return await orchestrator().status()

    @app.get("/api/agents", response_model=list[Agent], tags=["agents"])
    async def get_agents() -> list[Agent]:
        """Every registered agent, with live bond, reputation and dispute state."""
        return await orchestrator().agents()

    @app.get("/api/attestations", response_model=list[Attestation], tags=["attestations"])
    async def get_attestations(limit: int = Query(40, ge=1, le=200)) -> list[Attestation]:
        """The action feed, newest first."""
        return await orchestrator().attestations(limit)

    @app.get(
        "/api/attestations/{attestation_id}/trail",
        response_model=DecisionTrail,
        tags=["attestations"],
    )
    async def get_trail(attestation_id: int) -> DecisionTrail:
        """The revealed reasoning trail behind one attestation.

        The dashboard re-hashes what comes back and compares it to the
        commitment, so this endpoint is not trusted — it is checked.
        """
        trail = orchestrator().trail(attestation_id)
        if trail is None:
            raise HTTPException(status_code=404, detail=f"no trail stored for attestation {attestation_id}")
        return trail

    @app.get("/api/disputes", response_model=list[Dispute], tags=["disputes"])
    async def get_disputes() -> list[Dispute]:
        """Every dispute, newest first."""
        return await orchestrator().disputes()

    @app.post("/api/agents/{agent_id}/rogue", response_model=RogueResponse, tags=["agents"])
    async def post_rogue(agent_id: int) -> RogueResponse:
        """Makes an agent commit a decision that breaks its own declared policy."""
        try:
            attestation_id = await orchestrator().trigger_rogue(agent_id)
        except LedgerError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        return RogueResponse(attestationId=attestation_id)

    @app.post("/api/disputes/{dispute_id}/resolve", response_model=Dispute, tags=["disputes"])
    async def post_resolve(dispute_id: int, body: ResolveRequest) -> Dispute:
        """Arbiter verdict. Upholding slashes the bond; rejecting pays the agent."""
        try:
            return await orchestrator().resolve_dispute(dispute_id, body.upheld)
        except LedgerError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.post("/api/reset", status_code=204, tags=["system"])
    async def post_reset() -> None:
        """Restores the opening state so the demo can be re-run.

        Simulation only: a slash on a real chain cannot be undone, and this
        refuses rather than pretending otherwise.
        """
        try:
            await orchestrator().reset()
        except LedgerError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.get("/health", tags=["system"], include_in_schema=False)
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
