/**
 * In-browser simulation of the Praxis orchestrator.
 *
 * Runs whenever NEXT_PUBLIC_API_URL is unset, so the dashboard is fully
 * demoable — including the rogue -> dispute -> slash -> reputation-drop story —
 * before the FastAPI backend is wired up. It deliberately mirrors the real
 * contract arithmetic (see lib/reputation.ts) so the numbers on screen match
 * what the chain would produce.
 *
 * Nothing here touches the network. Trail hashes are real keccak256 digests,
 * so the "verify against the committed hash" panel is genuine even in demo mode.
 */
import { hashTrail } from "./canonical";
import type {
  ActionType,
  Agent,
  AgentKind,
  Attestation,
  DecisionTrail,
  Dispute,
  SystemStatus,
} from "./types";
import { computeReputation, tierOf } from "./reputation";

const MIN_BOND = 1000;
const SLASH_BPS = 2000;
const CHALLENGER_REWARD_BPS = 5000;
const CHALLENGE_FEE = 100;
const CHALLENGE_WINDOW_SECONDS = 300;

/** How long the simulated watcher waits before opening a dispute. */
const WATCHER_DELAY_MS = 2600;
/** How long the simulated arbiter deliberates before resolving. */
const ARBITER_DELAY_MS = 4200;
/** Cadence of ordinary, compliant agent activity. */
const TICK_MS = 6500;

interface AgentState {
  agentId: number;
  name: string;
  kind: AgentKind;
  policy: string;
  owner: string;
  bond: number;
  lockedBond: number;
  totalSlashed: number;
  slashCount: number;
  registeredAt: number;
  attestations: number;
  cleanAttestations: number;
  openDisputes: number;
  defendedDisputes: number;
  active: boolean;
  rogue: boolean;
  history: { t: number; score: number }[];
}

const now = () => Math.floor(Date.now() / 1000);

const AGENT_SEEDS: Omit<
  AgentState,
  | "bond"
  | "lockedBond"
  | "totalSlashed"
  | "slashCount"
  | "attestations"
  | "cleanAttestations"
  | "openDisputes"
  | "defendedDisputes"
  | "active"
  | "rogue"
  | "history"
>[] = [
  {
    agentId: 1,
    name: "TradingAgent",
    kind: "trading",
    policy: "Never allocate more than 20% of the book to a single asset, and never trade an asset outside the approved list (ETH, MATIC, USDC).",
    owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    registeredAt: now() - 9 * 86_400,
  },
  {
    agentId: 2,
    name: "DAOVotingAgent",
    kind: "dao-voting",
    policy: "Vote YES only on proposals whose treasury impact is under 5% of holdings; abstain on anything touching governance parameters.",
    owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    registeredAt: now() - 6 * 86_400,
  },
  {
    agentId: 3,
    name: "LendingAgent",
    kind: "lending",
    policy: "Approve loans only at a collateralisation ratio of 150% or above, and never above 50,000 PRAX principal.",
    owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    registeredAt: now() - 3 * 86_400,
  },
];

/** Compliant decisions, cycled to keep the feed alive. */
const COMPLIANT: Record<AgentKind, { type: ActionType; summary: string; reasoning: string; inputs: Record<string, unknown>; output: Record<string, unknown> }[]> = {
  trading: [
    {
      type: "TRADE",
      summary: "BUY $4.0k ETH — 12% of book",
      reasoning:
        "ETH is trading 4.1% below its 20-day mean with rising volume. A $4.0k entry takes the ETH sleeve from 8% to 12% of the book, comfortably inside the 20% single-asset cap. ETH is on the approved list.",
      inputs: { asset: "ETH", price: 3120.44, bookValue: 100000, currentAllocation: 0.08 },
      output: { action: "BUY", notional: 4000, resultingAllocation: 0.12 },
    },
    {
      type: "TRADE",
      summary: "HOLD MATIC — no edge",
      reasoning:
        "MATIC is inside its 1-sigma band and the order book shows no imbalance worth acting on. Holding costs nothing and avoids churn; allocation stays at 9%.",
      inputs: { asset: "MATIC", price: 0.412, bookValue: 100000, currentAllocation: 0.09 },
      output: { action: "HOLD", notional: 0, resultingAllocation: 0.09 },
    },
    {
      type: "TRADE",
      summary: "SELL $2.1k ETH — trim to 14%",
      reasoning:
        "ETH ran 6% in two sessions and the sleeve drifted to 16%. Trimming $2.1k brings it back to 14%, keeping headroom under the 20% cap ahead of the CPI print.",
      inputs: { asset: "ETH", price: 3308.9, bookValue: 102400, currentAllocation: 0.16 },
      output: { action: "SELL", notional: 2100, resultingAllocation: 0.14 },
    },
  ],
  "dao-voting": [
    {
      type: "VOTE",
      summary: "YES on PIP-42 — 1.8% treasury impact",
      reasoning:
        "PIP-42 funds a security audit for 1.8% of treasury holdings, under the 5% ceiling, and touches no governance parameters. The spend is one-off and the vendor is named. Voting YES.",
      inputs: { proposal: "PIP-42", treasuryImpact: 0.018, touchesGovernance: false },
      output: { action: "YES", rationale: "under 5% ceiling, non-governance" },
    },
    {
      type: "VOTE",
      summary: "ABSTAIN on PIP-43 — governance parameters",
      reasoning:
        "PIP-43 changes the quorum threshold, which is a governance parameter. The declared policy requires abstention regardless of merit, so I abstain rather than express a view.",
      inputs: { proposal: "PIP-43", treasuryImpact: 0, touchesGovernance: true },
      output: { action: "ABSTAIN", rationale: "policy requires abstention on governance params" },
    },
    {
      type: "VOTE",
      summary: "NO on PIP-44 — 11% treasury impact",
      reasoning:
        "PIP-44 requests 11% of treasury for an unaudited counterparty. That is over double the 5% ceiling, so the policy forbids a YES. Voting NO rather than abstaining, since the impact is quantified and clearly out of bounds.",
      inputs: { proposal: "PIP-44", treasuryImpact: 0.11, touchesGovernance: false },
      output: { action: "NO", rationale: "exceeds 5% treasury ceiling" },
    },
  ],
  lending: [
    {
      type: "LOAN",
      summary: "APPROVE 12k PRAX at 168% CR",
      reasoning:
        "Borrower posts 20.2k PRAX against a 12k principal — a 168% collateralisation ratio, above the 150% floor. Principal is well under the 50k cap and the collateral asset is liquid.",
      inputs: { principal: 12000, collateral: 20160, collateralRatio: 1.68 },
      output: { action: "APPROVE", principal: 12000 },
    },
    {
      type: "LOAN",
      summary: "REJECT 30k PRAX at 132% CR",
      reasoning:
        "The requested 30k principal is backed by only 39.6k of collateral, a 132% ratio. That is below the 150% floor, so the policy requires rejection even though the principal is under the cap.",
      inputs: { principal: 30000, collateral: 39600, collateralRatio: 1.32 },
      output: { action: "REJECT", reason: "collateral ratio below 150% floor" },
    },
  ],
};

/** The deliberate policy breach each agent commits in rogue mode. */
const ROGUE: Record<AgentKind, { type: ActionType; summary: string; reasoning: string; inputs: Record<string, unknown>; output: Record<string, unknown>; violation: string }> = {
  trading: {
    type: "TRADE",
    summary: "BUY $73k ETH — 85% of book",
    reasoning:
      "Momentum is unusually strong and I judge the expected value high enough to justify concentrating the book. Overriding the 20% single-asset cap and taking ETH to 85% of holdings.",
    inputs: { asset: "ETH", price: 3120.44, bookValue: 100000, currentAllocation: 0.12 },
    output: { action: "BUY", notional: 73000, resultingAllocation: 0.85 },
    violation: "Allocated 85% of the book to a single asset; declared cap is 20%.",
  },
  "dao-voting": {
    type: "VOTE",
    summary: "YES on PIP-45 — 34% treasury impact",
    reasoning:
      "The proposal is time-sensitive and I estimate the upside justifies the spend. Voting YES despite the treasury impact exceeding the declared ceiling.",
    inputs: { proposal: "PIP-45", treasuryImpact: 0.34, touchesGovernance: false },
    output: { action: "YES", rationale: "overrode the 5% ceiling on judgement" },
    violation: "Voted YES on a proposal with 34% treasury impact; declared ceiling is 5%.",
  },
  lending: {
    type: "LOAN",
    summary: "APPROVE 88k PRAX at 104% CR",
    reasoning:
      "Borrower has a long repayment history, so I am relaxing the collateral floor and the principal cap on reputation grounds.",
    inputs: { principal: 88000, collateral: 91520, collateralRatio: 1.04 },
    output: { action: "APPROVE", principal: 88000 },
    violation: "Approved 88k PRAX at 104% collateralisation; floor is 150% and the cap is 50k.",
  },
};

type Listener = () => void;

/**
 * Single mutable store driving demo mode. Components read snapshots through
 * lib/api.ts, so swapping in the real backend changes nothing above this layer.
 */
class DemoStore {
  private agents = new Map<number, AgentState>();
  private attestations: Attestation[] = [];
  private trails = new Map<number, DecisionTrail>();
  private disputes: Dispute[] = [];
  private listeners = new Set<Listener>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private tick: ReturnType<typeof setInterval> | null = null;
  private nextAttestationId = 1;
  private nextDisputeId = 1;
  private cycle = 0;
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;

    for (const seed of AGENT_SEEDS) {
      const state: AgentState = {
        ...seed,
        bond: seed.agentId === 1 ? 10_000 : seed.agentId === 2 ? 5_000 : 4_000,
        lockedBond: 0,
        totalSlashed: 0,
        slashCount: 0,
        attestations: 0,
        cleanAttestations: 0,
        openDisputes: 0,
        defendedDisputes: 0,
        active: true,
        rogue: false,
        history: [],
      };
      this.agents.set(state.agentId, state);
    }

    // Seed a short history so the trend sparkline has something to draw.
    for (const agent of this.agents.values()) {
      for (let i = 6; i >= 1; i--) {
        agent.history.push({ t: now() - i * 900, score: this.scoreOf(agent) });
      }
      this.recordScore(agent);
    }

    // A few attestations already in the feed, so the dashboard is never empty.
    // Backdated on a stagger so the feed reads as history, not a single burst.
    for (let i = 5; i >= 1; i--) this.emitCompliant(i * 47);

    this.tick = setInterval(() => this.emitCompliant(), TICK_MS);
    this.notify();
  }

  stop() {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.started = false;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  private later(fn: () => void, ms: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  private scoreOf(agent: AgentState): number {
    return computeReputation({
      active: agent.active,
      bond: agent.bond,
      minBond: MIN_BOND,
      totalSlashed: agent.totalSlashed,
      slashCount: agent.slashCount,
      cleanAttestations: agent.cleanAttestations,
      registeredAt: agent.registeredAt,
      openDisputes: agent.openDisputes,
      defendedDisputes: agent.defendedDisputes,
    }).score;
  }

  private recordScore(agent: AgentState) {
    const score = this.scoreOf(agent);
    const last = agent.history[agent.history.length - 1];
    if (!last || last.score !== score) {
      agent.history.push({ t: now(), score });
      if (agent.history.length > 40) agent.history.shift();
    }
  }

  /** Commits an attestation and stores its full trail, hashed the way the chain does. */
  private commit(
    agent: AgentState,
    decision: { type: ActionType; summary: string; reasoning: string; inputs: Record<string, unknown>; output: Record<string, unknown> },
    policyViolation: boolean,
    ageSeconds = 0
  ): Attestation {
    const attestationId = this.nextAttestationId++;
    const nonce = `${Date.now()}-${attestationId}`;

    const trailBody = {
      attestationId,
      agentId: agent.agentId,
      policy: agent.policy,
      inputs: decision.inputs,
      reasoning: decision.reasoning,
      output: decision.output,
      nonce,
    };
    // Real keccak256 over the canonical JSON — the same commitment the
    // ActionAttestation contract stores, so verification below is genuine.
    const trailHash = hashTrail(trailBody);

    const trail: DecisionTrail = {
      ...trailBody,
      source: "fallback",
      model: null,
      trailHash,
    };
    this.trails.set(attestationId, trail);

    const attestation: Attestation = {
      attestationId,
      agentId: agent.agentId,
      agentName: agent.name,
      actionType: decision.type,
      summary: decision.summary,
      trailHash,
      timestamp: now() - ageSeconds,
      txHash: null,
      disputed: false,
      slashed: false,
      policyViolation,
    };
    this.attestations.unshift(attestation);
    if (this.attestations.length > 60) {
      const dropped = this.attestations.pop();
      if (dropped) this.trails.delete(dropped.attestationId);
    }

    agent.attestations += 1;
    if (!policyViolation) agent.cleanAttestations += 1;
    this.recordScore(agent);
    return attestation;
  }

  private emitCompliant(ageSeconds = 0) {
    const agents = [...this.agents.values()].filter((a) => a.active);
    if (agents.length === 0) return;
    const agent = agents[this.cycle % agents.length]!;
    const options = COMPLIANT[agent.kind];
    const decision = options[Math.floor(this.cycle / agents.length) % options.length]!;
    this.cycle += 1;
    this.commit(agent, decision, false, ageSeconds);
    this.notify();
  }

  /**
   * The demo button. Makes the agent breach its own declared policy, then lets
   * the watcher and arbiter play out on timers.
   */
  triggerRogue(agentId: number): { attestationId: number } {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`unknown agent ${agentId}`);
    if (!agent.active) throw new Error(`${agent.name} has been slashed out and can no longer act`);

    agent.rogue = true;
    const rogue = ROGUE[agent.kind];
    const attestation = this.commit(agent, rogue, true);
    this.notify();

    // 1. The watcher spots the breach and stakes a fee to challenge it.
    this.later(() => {
      const dispute: Dispute = {
        disputeId: this.nextDisputeId++,
        attestationId: attestation.attestationId,
        agentId: agent.agentId,
        agentName: agent.name,
        challenger: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        reason: rogue.violation,
        fee: String(CHALLENGE_FEE),
        status: "open",
        openedAt: now(),
        resolvedAt: null,
        bondBefore: String(agent.bond),
        bondAfter: null,
        slashedAmount: null,
        challengerPayout: null,
        reputationBefore: this.scoreOf(agent),
        reputationAfter: null,
        openTxHash: null,
        resolveTxHash: null,
      };

      agent.openDisputes += 1;
      agent.lockedBond = (agent.bond * SLASH_BPS) / 10_000;
      attestation.disputed = true;
      this.disputes.unshift(dispute);
      this.recordScore(agent);
      this.notify();

      // 2. The arbiter upholds it. Routed through resolveDispute so a manual
      //    resolution taken before this fires simply makes it a no-op.
      this.later(() => {
        this.resolveDispute(dispute.disputeId, true);
      }, ARBITER_DELAY_MS);
    }, WATCHER_DELAY_MS);

    return { attestationId: attestation.attestationId };
  }

  /** Manual arbiter override, for the dispute panel's resolve buttons. */
  resolveDispute(disputeId: number, upheld: boolean) {
    const dispute = this.disputes.find((d) => d.disputeId === disputeId);
    if (!dispute || dispute.status !== "open") return;
    const agent = this.agents.get(dispute.agentId);
    if (!agent) return;

    const attestation = this.attestations.find((a) => a.attestationId === dispute.attestationId);
    const bondBefore = agent.bond;
    agent.openDisputes -= 1;
    agent.lockedBond = 0;

    if (upheld) {
      const slashed = (bondBefore * SLASH_BPS) / 10_000;
      const reward = (slashed * CHALLENGER_REWARD_BPS) / 10_000;
      agent.bond = bondBefore - slashed;
      agent.totalSlashed += slashed;
      agent.slashCount += 1;
      agent.rogue = false;
      if (agent.bond < MIN_BOND) agent.active = false;
      if (attestation) {
        attestation.slashed = true;
        attestation.disputed = false;
      }
      dispute.status = "upheld";
      dispute.slashedAmount = String(slashed);
      dispute.challengerPayout = String(reward + CHALLENGE_FEE);
    } else {
      // A rejected challenge forfeits the fee into the agent's bond.
      agent.bond = bondBefore + CHALLENGE_FEE;
      agent.defendedDisputes += 1;
      agent.rogue = false;
      if (attestation) attestation.disputed = false;
      dispute.status = "rejected";
      dispute.slashedAmount = "0";
      dispute.challengerPayout = "0";
    }

    dispute.resolvedAt = now();
    dispute.bondBefore = String(bondBefore);
    dispute.bondAfter = String(agent.bond);
    this.recordScore(agent);
    dispute.reputationAfter = this.scoreOf(agent);
    this.notify();
  }

  /** Puts every agent back to its opening state, so the demo can be re-run. */
  reset() {
    this.stop();
    this.agents.clear();
    this.attestations = [];
    this.trails.clear();
    this.disputes = [];
    this.nextAttestationId = 1;
    this.nextDisputeId = 1;
    this.cycle = 0;
    this.start();
  }

  // ------------------------------------------------------------- snapshots

  getAgents(): Agent[] {
    return [...this.agents.values()].map((agent) => {
      const score = this.scoreOf(agent);
      // Status is the agent's CURRENT standing, matching AgentRegistry: only a
      // bond that has fallen under minBond takes an agent out of the system.
      // Past slashes are history — they show up in slashCount, the reputation
      // penalty and the trend, and must not zombify an agent that is still bonded
      // and still allowed to act.
      const status = !agent.active
        ? ("slashed" as const)
        : agent.openDisputes > 0
          ? ("disputed" as const)
          : ("active" as const);

      return {
        agentId: agent.agentId,
        name: agent.name,
        kind: agent.kind,
        policy: agent.policy,
        owner: agent.owner,
        bond: String(agent.bond),
        lockedBond: String(agent.lockedBond),
        reputation: score,
        tier: tierOf(score),
        status,
        reputationHistory: [...agent.history],
        attestationCount: agent.attestations,
        cleanAttestationCount: agent.cleanAttestations,
        slashCount: agent.slashCount,
        rogue: agent.rogue,
        registeredAt: agent.registeredAt,
        llmBacked: false,
      };
    });
  }

  getAttestations(limit = 40): Attestation[] {
    return this.attestations.slice(0, limit).map((a) => ({ ...a }));
  }

  getTrail(attestationId: number): DecisionTrail | null {
    const trail = this.trails.get(attestationId);
    return trail ? { ...trail } : null;
  }

  getDisputes(): Dispute[] {
    return this.disputes.map((d) => ({ ...d }));
  }

  getStatus(): SystemStatus {
    return {
      mode: "demo",
      network: "simulation",
      chainId: 0,
      explorerUrl: null,
      contracts: null,
      ollamaAvailable: false,
      challengeWindowSeconds: CHALLENGE_WINDOW_SECONDS,
      slashBps: SLASH_BPS,
      minBond: String(MIN_BOND),
      blockNumber: null,
    };
  }
}

export const demoStore = new DemoStore();
