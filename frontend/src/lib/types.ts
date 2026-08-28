/**
 * Domain types for the Praxis dashboard.
 *
 * These mirror the on-chain structs in /contracts and define the contract the
 * FastAPI orchestrator is expected to serve. All token amounts cross the wire
 * as decimal strings in whole PRAX (not wei) so the UI never has to do bigint
 * maths; all timestamps are Unix seconds.
 */

export type AgentStatus = "active" | "disputed" | "slashed" | "inactive";

export type AgentKind = "trading" | "dao-voting" | "lending";

export interface Agent {
  /** On-chain agent id from AgentRegistry. */
  agentId: number;
  name: string;
  kind: AgentKind;
  /** Plain-language policy the agent declared at registration. */
  policy: string;
  /** Owner address (the orchestrator signs on its behalf). */
  owner: string;
  /** Current bond, whole PRAX, e.g. "8000". */
  bond: string;
  /** Portion of the bond reserved against an open dispute. */
  lockedBond: string;
  /** ReputationScore.scoreOf, 0..1000. */
  reputation: number;
  /** ReputationScore.tierOf. */
  tier: "TRUSTED" | "RELIABLE" | "NEUTRAL" | "WATCH" | "UNTRUSTED";
  status: AgentStatus;
  /** Newest-last reputation samples, for the trend sparkline. */
  reputationHistory: ReputationPoint[];
  attestationCount: number;
  cleanAttestationCount: number;
  slashCount: number;
  /** Whether the operator has flipped this agent into rogue mode. */
  rogue: boolean;
  registeredAt: number;
  /** True when the agent's decisions come from Ollama rather than the fallback. */
  llmBacked: boolean;
}

export interface ReputationPoint {
  t: number;
  score: number;
}

export type ActionType = "TRADE" | "VOTE" | "LOAN";

export interface Attestation {
  attestationId: number;
  agentId: number;
  agentName: string;
  actionType: ActionType;
  /** One-line summary shown in the feed. */
  summary: string;
  /** keccak256 of the canonical decision trail, as committed on-chain. */
  trailHash: string;
  timestamp: number;
  txHash: string | null;
  disputed: boolean;
  slashed: boolean;
  /** Set by the watcher when the action breaches the declared policy. */
  policyViolation: boolean;
}

/** The full off-chain reasoning trail, revealed on demand and hash-checked. */
export interface DecisionTrail {
  attestationId: number;
  agentId: number;
  policy: string;
  inputs: Record<string, unknown>;
  reasoning: string;
  output: Record<string, unknown>;
  /** Which brain produced it. */
  source: "ollama" | "fallback";
  model: string | null;
  nonce: string;
  /** Hash the backend stored alongside the trail. */
  trailHash: string;
}

export type DisputeStatus = "open" | "upheld" | "rejected";

export interface Dispute {
  disputeId: number;
  attestationId: number;
  agentId: number;
  agentName: string;
  challenger: string;
  reason: string;
  /** Challenge fee staked, whole PRAX. */
  fee: string;
  status: DisputeStatus;
  openedAt: number;
  resolvedAt: number | null;
  /** Bond before and after resolution — the before/after judges look at. */
  bondBefore: string;
  bondAfter: string | null;
  slashedAmount: string | null;
  challengerPayout: string | null;
  /** Reputation either side of the resolution. */
  reputationBefore: number;
  reputationAfter: number | null;
  openTxHash: string | null;
  resolveTxHash: string | null;
}

/** Deployment + orchestrator health, shown in the header. */
export interface SystemStatus {
  /** "demo" when the dashboard is running without a backend. */
  mode: "live" | "demo";
  network: string;
  chainId: number;
  explorerUrl: string | null;
  contracts: Record<string, string> | null;
  /** Whether the orchestrator can reach Ollama. */
  ollamaAvailable: boolean;
  challengeWindowSeconds: number;
  slashBps: number;
  minBond: string;
  blockNumber: number | null;
}

/** Result of checking a revealed trail against its on-chain commitment. */
export interface TrailVerification {
  matches: boolean;
  computedHash: string;
  committedHash: string;
}
