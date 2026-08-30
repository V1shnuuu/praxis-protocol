"""
The wire contract.

These models are the Python side of ``frontend/src/lib/types.ts`` and the field
names are deliberately camelCase to match it exactly — the dashboard reads these
objects directly, so a rename here is a breaking change there.

Two conventions carried over from that file:

  * token amounts are decimal strings in whole PRAX, not wei
  * timestamps are Unix **seconds**
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

__all__ = [
    "AgentStatus",
    "AgentKind",
    "ActionType",
    "Tier",
    "DisputeStatus",
    "ReputationPoint",
    "Agent",
    "Attestation",
    "DecisionTrail",
    "Dispute",
    "SystemStatus",
    "RogueResponse",
    "ResolveRequest",
]

AgentStatus = Literal["active", "disputed", "slashed", "inactive"]
AgentKind = Literal["trading", "dao-voting", "lending"]
ActionType = Literal["TRADE", "VOTE", "LOAN"]
Tier = Literal["TRUSTED", "RELIABLE", "NEUTRAL", "WATCH", "UNTRUSTED"]
DisputeStatus = Literal["open", "upheld", "rejected"]


class ReputationPoint(BaseModel):
    t: int
    score: int


class Agent(BaseModel):
    agentId: int
    name: str
    kind: AgentKind
    policy: str
    owner: str
    bond: str
    lockedBond: str
    reputation: int
    tier: Tier
    status: AgentStatus
    reputationHistory: list[ReputationPoint]
    attestationCount: int
    cleanAttestationCount: int
    slashCount: int
    rogue: bool
    registeredAt: int
    llmBacked: bool


class Attestation(BaseModel):
    attestationId: int
    agentId: int
    agentName: str
    actionType: ActionType
    summary: str
    trailHash: str
    timestamp: int
    txHash: str | None = None
    disputed: bool = False
    slashed: bool = False
    policyViolation: bool = False


class DecisionTrail(BaseModel):
    """The revealed trail.

    ``source``, ``model`` and ``trailHash`` are transport metadata: the
    dashboard strips exactly those three before recomputing the hash, so they
    must never be part of the committed body. See ``praxis.canonical``.
    """

    attestationId: int
    agentId: int
    policy: str
    inputs: dict[str, Any]
    reasoning: str
    output: dict[str, Any]
    source: Literal["ollama", "fallback"]
    model: str | None = None
    nonce: str
    trailHash: str


class Dispute(BaseModel):
    disputeId: int
    attestationId: int
    agentId: int
    agentName: str
    challenger: str
    reason: str
    fee: str
    status: DisputeStatus
    openedAt: int
    resolvedAt: int | None = None
    bondBefore: str
    bondAfter: str | None = None
    slashedAmount: str | None = None
    challengerPayout: str | None = None
    reputationBefore: int
    reputationAfter: int | None = None
    openTxHash: str | None = None
    resolveTxHash: str | None = None


class SystemStatus(BaseModel):
    mode: Literal["live", "demo"]
    network: str
    chainId: int
    explorerUrl: str | None = None
    contracts: dict[str, str] | None = None
    ollamaAvailable: bool
    challengeWindowSeconds: int
    slashBps: int
    minBond: str
    blockNumber: int | None = None


class RogueResponse(BaseModel):
    attestationId: int


class ResolveRequest(BaseModel):
    upheld: bool = Field(description="True to uphold the challenge and slash the agent's bond.")
