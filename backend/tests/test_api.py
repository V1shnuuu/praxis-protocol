"""
The REST contract the dashboard is written against.

``frontend/src/lib/api.ts`` declares seven routes and two conventions (whole-PRAX
decimal strings, Unix seconds). These tests hold the backend to both, and then
drive the demo's headline flow end to end: an agent breaks its declared policy, a
watcher catches it, the arbiter upholds, the bond is slashed and the reputation
drops.
"""

from __future__ import annotations

import asyncio
from dataclasses import replace

import httpx
import pytest

from praxis.api import build_ledger, create_app
from praxis.canonical import hash_trail
from praxis.config import Settings
from praxis.ledger import SimulatedLedger
from praxis.store import TrailStore
from praxis.units import to_wei

TIMEOUT = 10.0


@pytest.fixture
async def client(settings: Settings, ledger: SimulatedLedger, store: TrailStore):
    """The app on a real ASGI transport, wired to the in-process ledger."""
    # The orchestrator's own clock has to move for challenge windows to behave,
    # so the ledger fixture's frozen clock is not used here.
    live_ledger = SimulatedLedger(
        min_bond_wei=settings.min_bond_wei,
        challenge_fee_wei=settings.challenge_fee_wei,
        challenge_window_seconds=settings.challenge_window_seconds,
        slash_bps=settings.slash_bps,
        challenger_reward_bps=settings.challenger_reward_bps,
    )
    app = create_app(settings, ledger=live_ledger, store=store, autostart=True)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://praxis") as http:
        async with app.router.lifespan_context(app):
            yield http


async def _await_dispute(http: httpx.AsyncClient, *, status: str | None = None) -> list[dict]:
    """Polls until a dispute exists (optionally in a given state)."""
    deadline = asyncio.get_running_loop().time() + TIMEOUT
    while asyncio.get_running_loop().time() < deadline:
        disputes = (await http.get("/api/disputes")).json()
        if disputes and (status is None or disputes[0]["status"] == status):
            return disputes
        await asyncio.sleep(0.02)
    raise AssertionError(f"no dispute reached {status or 'existence'} within {TIMEOUT}s")


async def _rogue_and_settle(http: httpx.AsyncClient, agent_id: int) -> dict:
    """Sends an agent rogue and waits for *its own* dispute to be resolved.

    Waiting on ``disputes[0]`` alone is not enough once an agent has been slashed
    before: the previous verdict is still at the head of the list and would be
    read as this one's.
    """
    before = len((await http.get("/api/disputes")).json())
    response = await http.post(f"/api/agents/{agent_id}/rogue")
    assert response.status_code == 200, response.json()

    deadline = asyncio.get_running_loop().time() + TIMEOUT
    while asyncio.get_running_loop().time() < deadline:
        disputes = (await http.get("/api/disputes")).json()
        if len(disputes) > before and disputes[0]["status"] != "open":
            return disputes[0]
        await asyncio.sleep(0.02)
    raise AssertionError(f"the new dispute did not resolve within {TIMEOUT}s")


# ----------------------------------------------------------------------- status


async def test_status_reports_the_ledger_it_is_running_against(client):
    """`mode` says an orchestrator is answering; the chain fields say whether
    one is attached.

    Reporting "demo" here would make the dashboard claim it is "driving itself
    from an in-browser simulation" while it is in fact driving this service.
    """
    body = (await client.get("/api/status")).json()
    assert body["mode"] == "live"
    assert body["network"] == "simulation"  # ...but no chain behind it
    assert body["chainId"] == 0
    assert body["contracts"] is None
    assert body["minBond"] == "1000"
    assert body["slashBps"] == 2000
    assert body["challengeWindowSeconds"] == 300
    assert body["ollamaAvailable"] is False


async def test_health_is_served(client):
    assert (await client.get("/health")).json() == {"status": "ok"}


# ----------------------------------------------------------------------- agents


async def test_agents_are_registered_and_bonded(client):
    agents = (await client.get("/api/agents")).json()
    assert [a["name"] for a in agents] == ["TradingAgent", "DAOVotingAgent", "LendingAgent"]
    assert [a["bond"] for a in agents] == ["10000", "5000", "4000"]
    assert all(a["status"] == "active" for a in agents)
    assert all(a["lockedBond"] == "0" for a in agents)


async def test_agent_fields_match_the_dashboards_types(client):
    agent = (await client.get("/api/agents")).json()[0]
    assert set(agent) == {
        "agentId",
        "name",
        "kind",
        "policy",
        "owner",
        "bond",
        "lockedBond",
        "reputation",
        "tier",
        "status",
        "reputationHistory",
        "attestationCount",
        "cleanAttestationCount",
        "slashCount",
        "rogue",
        "registeredAt",
        "llmBacked",
    }
    assert isinstance(agent["bond"], str)  # whole PRAX, not wei
    assert 0 <= agent["reputation"] <= 1000
    assert agent["tier"] in {"TRUSTED", "RELIABLE", "NEUTRAL", "WATCH", "UNTRUSTED"}
    assert agent["registeredAt"] > 1_600_000_000  # seconds, not milliseconds


async def test_the_declared_policy_is_the_one_the_watcher_enforces(client):
    for agent in (await client.get("/api/agents")).json():
        assert agent["policy"].endswith(".")
        assert "%" in agent["policy"]


# ------------------------------------------------------------------ attestations


async def test_the_feed_is_populated_newest_first(client):
    feed = (await client.get("/api/attestations")).json()
    assert len(feed) >= 3
    assert feed == sorted(feed, key=lambda a: a["attestationId"], reverse=True)
    assert all(a["actionType"] in {"TRADE", "VOTE", "LOAN"} for a in feed)


async def test_the_feed_respects_its_limit(client):
    assert len(((await client.get("/api/attestations?limit=2")).json())) == 2


async def test_an_out_of_range_limit_is_rejected(client):
    assert (await client.get("/api/attestations?limit=0")).status_code == 422


async def test_seeded_decisions_are_all_compliant(client):
    """The agents' own rules must never trip their own watcher."""
    feed = (await client.get("/api/attestations")).json()
    assert not any(a["policyViolation"] for a in feed)


# ------------------------------------------------------------------------ trails


async def test_a_revealed_trail_verifies_against_its_commitment(client):
    """The dashboard's check, run here: strip the metadata, re-hash, compare."""
    attestation = (await client.get("/api/attestations")).json()[0]
    trail = (await client.get(f"/api/attestations/{attestation['attestationId']}/trail")).json()

    body = {k: v for k, v in trail.items() if k not in ("source", "model", "trailHash")}
    assert hash_trail(body) == attestation["trailHash"]
    assert trail["trailHash"] == attestation["trailHash"]


async def test_a_trail_carries_which_brain_produced_it(client):
    attestation = (await client.get("/api/attestations")).json()[0]
    trail = (await client.get(f"/api/attestations/{attestation['attestationId']}/trail")).json()
    assert trail["source"] == "fallback"
    assert trail["model"] is None
    assert trail["reasoning"]


async def test_an_unknown_trail_is_a_404(client):
    response = await client.get("/api/attestations/9999/trail")
    assert response.status_code == 404
    assert "9999" in response.json()["detail"]


# ------------------------------------------------- the rogue -> slash flow


async def test_rogue_commits_a_violation_that_the_watcher_catches(client):
    agent = (await client.get("/api/agents")).json()[0]

    response = await client.post(f"/api/agents/{agent['agentId']}/rogue")
    assert response.status_code == 200
    attestation_id = response.json()["attestationId"]

    feed = (await client.get("/api/attestations")).json()
    rogue = next(a for a in feed if a["attestationId"] == attestation_id)
    assert rogue["policyViolation"] is True
    assert "85%" in rogue["summary"]

    disputes = await _await_dispute(client)
    assert disputes[0]["attestationId"] == attestation_id
    assert "85%" in disputes[0]["reason"]


async def test_the_upheld_dispute_slashes_the_bond_and_pays_the_challenger(client):
    agent = (await client.get("/api/agents")).json()[0]
    await client.post(f"/api/agents/{agent['agentId']}/rogue")

    dispute = (await _await_dispute(client, status="upheld"))[0]
    assert dispute["bondBefore"] == "10000"
    assert dispute["bondAfter"] == "8000"
    assert dispute["slashedAmount"] == "2000"
    assert dispute["challengerPayout"] == "1100"  # 50% of the slash, plus the fee back
    assert dispute["fee"] == "100"
    assert dispute["resolvedAt"] is not None
    assert dispute["reputationAfter"] < dispute["reputationBefore"]


async def test_the_slashed_agent_carries_the_mark(client):
    """A slash is permanent history, but it is not a life sentence.

    ``status`` is current standing, per the semantics documented in types.ts:
    an agent still bonded above minBond stays ``active`` and can act again. The
    slash shows up in slashCount, the reputation penalty and the trend.
    """
    agent = (await client.get("/api/agents")).json()[0]
    await client.post(f"/api/agents/{agent['agentId']}/rogue")
    await _await_dispute(client, status="upheld")

    after = next(
        a for a in (await client.get("/api/agents")).json() if a["agentId"] == agent["agentId"]
    )
    assert after["bond"] == "8000"  # still well above the 1,000 minimum
    assert after["slashCount"] == 1
    assert after["status"] == "active"
    assert after["reputation"] < agent["reputation"]
    assert after["rogue"] is False  # caught, so no longer rogue
    assert len(after["reputationHistory"]) >= 2


async def test_an_agent_can_be_sent_rogue_more_than_once(client):
    """Regression: a demo that only runs once is a demo that fails on the day.

    Reporting any past slash as ``slashed`` used to take the agent out of the
    eligible set, so each agent could be demoed exactly once.
    """
    agent = (await client.get("/api/agents")).json()[0]

    for expected_bond, expected_slashes in (("8000", 1), ("6400", 2)):
        await _rogue_and_settle(client, agent["agentId"])

        after = next(
            a for a in (await client.get("/api/agents")).json() if a["agentId"] == agent["agentId"]
        )
        assert after["bond"] == expected_bond  # 20% of the remaining bond each time
        assert after["slashCount"] == expected_slashes
        assert after["status"] == "active"


async def test_an_agent_slashed_under_the_minimum_bond_is_out(client):
    """The one case that does end in ``slashed``: AgentRegistry deactivates it."""
    # 4,000 PRAX loses 20% of what remains each time:
    #   3200, 2560, 2048, 1638.4, 1310.72, 1048.576, then 838.8608 — the first
    # figure under the 1,000 minimum. The fractions are real: the contract
    # divides in wei, and format_prax reports the amount exactly rather than
    # rounding it into something the chain would disagree with.
    agents = (await client.get("/api/agents")).json()
    lending = next(a for a in agents if a["name"] == "LendingAgent")

    bonds = []
    for _ in range(7):
        await _rogue_and_settle(client, lending["agentId"])
        after = next(
            a for a in (await client.get("/api/agents")).json() if a["agentId"] == lending["agentId"]
        )
        bonds.append(after["bond"])

    assert bonds == ["3200", "2560", "2048", "1638.4", "1310.72", "1048.576", "838.8608"]

    # Only the last one takes it out of the system.
    assert after["status"] == "slashed"
    assert float(after["bond"]) < 1000
    assert after["slashCount"] == 7
    assert after["reputation"] == 0  # an inactive agent scores nothing

    # And it can no longer act.
    assert (await client.post(f"/api/agents/{lending['agentId']}/rogue")).status_code == 409


async def test_the_rogue_attestation_is_permanently_marked(client):
    agent = (await client.get("/api/agents")).json()[0]
    attestation_id = (await client.post(f"/api/agents/{agent['agentId']}/rogue")).json()[
        "attestationId"
    ]
    await _await_dispute(client, status="upheld")

    feed = (await client.get("/api/attestations")).json()
    rogue = next(a for a in feed if a["attestationId"] == attestation_id)
    assert rogue["slashed"] is True
    assert rogue["disputed"] is False
    assert rogue["policyViolation"] is True


async def test_rogue_on_an_unknown_agent_is_a_conflict(client):
    response = await client.post("/api/agents/9999/rogue")
    assert response.status_code == 409


# ----------------------------------------------------------------- arbitration


async def test_an_arbiter_can_reject_a_challenge_and_pay_the_agent(
    manual_arbiter, store, tmp_path
):
    """A rejected dispute leaves an honest agent better off than before it."""
    ledger = SimulatedLedger(
        min_bond_wei=manual_arbiter.min_bond_wei,
        challenge_fee_wei=manual_arbiter.challenge_fee_wei,
        challenge_window_seconds=manual_arbiter.challenge_window_seconds,
        slash_bps=manual_arbiter.slash_bps,
        challenger_reward_bps=manual_arbiter.challenger_reward_bps,
    )
    app = create_app(manual_arbiter, ledger=ledger, store=store, autostart=True)
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://praxis") as http:
        async with app.router.lifespan_context(app):
            agent = (await http.get("/api/agents")).json()[0]
            await http.post(f"/api/agents/{agent['agentId']}/rogue")
            dispute = (await _await_dispute(http, status="open"))[0]

            resolved = (
                await http.post(
                    f"/api/disputes/{dispute['disputeId']}/resolve", json={"upheld": False}
                )
            ).json()

            assert resolved["status"] == "rejected"
            assert resolved["slashedAmount"] == "0"
            assert resolved["challengerPayout"] == "0"
            assert resolved["bondAfter"] == "10100"  # the forfeited fee

            after = next(
                a
                for a in (await http.get("/api/agents")).json()
                if a["agentId"] == agent["agentId"]
            )
            assert after["slashCount"] == 0
            assert after["status"] == "active"


async def test_resolving_a_dispute_twice_is_a_conflict(client):
    agent = (await client.get("/api/agents")).json()[0]
    await client.post(f"/api/agents/{agent['agentId']}/rogue")
    dispute = (await _await_dispute(client, status="upheld"))[0]

    response = await client.post(
        f"/api/disputes/{dispute['disputeId']}/resolve", json={"upheld": True}
    )
    assert response.status_code == 409


async def test_resolving_an_unknown_dispute_is_a_conflict(client):
    assert (await client.post("/api/disputes/9999/resolve", json={"upheld": True})).status_code == 409


async def test_resolve_requires_a_verdict(client):
    assert (await client.post("/api/disputes/1/resolve", json={})).status_code == 422


# ---------------------------------------------------------------------- disputes


async def test_dispute_fields_match_the_dashboards_types(client):
    agent = (await client.get("/api/agents")).json()[0]
    await client.post(f"/api/agents/{agent['agentId']}/rogue")
    dispute = (await _await_dispute(client, status="upheld"))[0]

    assert set(dispute) == {
        "disputeId",
        "attestationId",
        "agentId",
        "agentName",
        "challenger",
        "reason",
        "fee",
        "status",
        "openedAt",
        "resolvedAt",
        "bondBefore",
        "bondAfter",
        "slashedAmount",
        "challengerPayout",
        "reputationBefore",
        "reputationAfter",
        "openTxHash",
        "resolveTxHash",
    }
    assert dispute["challenger"].startswith("0x")
    assert dispute["agentName"] == "TradingAgent"
    assert dispute["openTxHash"] is None  # no chain attached


# ------------------------------------------------------------------------- reset


async def test_reset_restores_the_opening_state(client):
    agent = (await client.get("/api/agents")).json()[0]
    await client.post(f"/api/agents/{agent['agentId']}/rogue")
    await _await_dispute(client, status="upheld")

    assert (await client.post("/api/reset")).status_code == 204

    agents = (await client.get("/api/agents")).json()
    assert [a["bond"] for a in agents] == ["10000", "5000", "4000"]
    assert all(a["slashCount"] == 0 for a in agents)
    assert (await client.get("/api/disputes")).json() == []


# ------------------------------------------------------------ ledger selection


def test_auto_mode_falls_back_to_the_simulation_without_a_deployment(settings):
    assert isinstance(build_ledger(replace(settings, mode="auto")), SimulatedLedger)


def test_live_mode_refuses_to_pretend(settings):
    with pytest.raises(RuntimeError, match="chain is unavailable"):
        build_ledger(replace(settings, mode="live"))


def test_live_mode_also_refuses_without_signing_keys(settings, tmp_path):
    deployment = tmp_path / "deployed-addresses.json"
    deployment.write_text('{"amoy": {"contracts": {}}}', encoding="utf-8")
    broken = replace(settings, mode="live", network="amoy", deployment_file=deployment)
    with pytest.raises(RuntimeError, match="PRIVATE_KEY"):
        build_ledger(broken)


async def test_bond_amounts_cross_the_wire_as_whole_prax(client):
    """The dashboard's convention: "8000", never "8000000000000000000000"."""
    for agent in (await client.get("/api/agents")).json():
        assert "." not in agent["bond"]
        assert int(agent["bond"]) < 10**9
    assert to_wei(10_000) == 10_000 * 10**18  # and the ledger really is in wei


async def test_every_stored_trail_matches_its_committed_digest(client):
    """The invariant the whole design rests on, checked across the whole feed."""
    feed = (await client.get("/api/attestations?limit=200")).json()
    assert feed

    for attestation in feed:
        trail = (await client.get(f"/api/attestations/{attestation['attestationId']}/trail")).json()
        body = {k: v for k, v in trail.items() if k not in ("source", "model", "trailHash")}
        assert hash_trail(body) == attestation["trailHash"], (
            f"attestation {attestation['attestationId']} would fail verification in the browser"
        )


async def test_commitments_survive_a_rogue_trigger_racing_the_tick_loop(client):
    """Reserving an attestation id and committing against it has to be atomic.

    Two decisions interleaving there would hash against the same id, and one of
    them would commit a digest belonging to the other — a mismatch the dashboard
    would report on a perfectly honest trail.
    """
    agents = (await client.get("/api/agents")).json()

    # Fire every agent at once, straight into the ongoing tick loop.
    await asyncio.gather(
        *(client.post(f"/api/agents/{a['agentId']}/rogue") for a in agents),
        return_exceptions=True,
    )
    await asyncio.sleep(0.4)

    feed = (await client.get("/api/attestations?limit=200")).json()
    ids = [a["attestationId"] for a in feed]
    assert len(ids) == len(set(ids)), "an attestation id was reused"

    for attestation in feed:
        trail = (await client.get(f"/api/attestations/{attestation['attestationId']}/trail")).json()
        body = {k: v for k, v in trail.items() if k not in ("source", "model", "trailHash")}
        assert hash_trail(body) == attestation["trailHash"]
        assert body["attestationId"] == attestation["attestationId"]
