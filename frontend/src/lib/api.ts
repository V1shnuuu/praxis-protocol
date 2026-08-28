/**
 * The one place the dashboard talks to the outside world.
 *
 * Two implementations behind one interface:
 *   - demo   : the in-browser simulation (lib/demo-store.ts), used when
 *              NEXT_PUBLIC_API_URL is unset
 *   - http   : the FastAPI orchestrator
 *
 * Every component above this file is written against `PraxisApi`, so wiring the
 * real backend is a change here and nowhere else.
 *
 * ---------------------------------------------------------------------------
 * Expected backend contract (FastAPI). Field shapes are in lib/types.ts.
 *
 *   GET  /api/status                     -> SystemStatus
 *   GET  /api/agents                     -> Agent[]
 *   GET  /api/attestations?limit=40      -> Attestation[]
 *   GET  /api/attestations/{id}/trail    -> DecisionTrail
 *   GET  /api/disputes                   -> Dispute[]
 *   POST /api/agents/{id}/rogue          -> { attestationId: number }
 *   POST /api/disputes/{id}/resolve      -> Dispute      body: { upheld: boolean }
 *
 * If the real routes differ, remap them in `httpApi` below — that is the whole
 * integration surface. Set NEXT_PUBLIC_API_PATHS_* overrides or edit `paths`.
 * ---------------------------------------------------------------------------
 */
import { config } from "./config";
import { demoStore } from "./demo-store";
import type { Agent, Attestation, DecisionTrail, Dispute, SystemStatus, TrailVerification } from "./types";
import { hashTrail } from "./canonical";

export interface PraxisApi {
  readonly mode: "live" | "demo";
  getStatus(): Promise<SystemStatus>;
  getAgents(): Promise<Agent[]>;
  getAttestations(limit?: number): Promise<Attestation[]>;
  getTrail(attestationId: number): Promise<DecisionTrail | null>;
  getDisputes(): Promise<Dispute[]>;
  triggerRogue(agentId: number): Promise<{ attestationId: number }>;
  resolveDispute(disputeId: number, upheld: boolean): Promise<void>;
  /** Demo mode only; a no-op against a live backend. */
  reset?(): Promise<void>;
  /** Push-style updates. Demo mode notifies instantly; HTTP mode polls. */
  subscribe(listener: () => void): () => void;
}

/** Route table, kept in one object so remapping to different backend paths is trivial. */
const paths = {
  status: "/api/status",
  agents: "/api/agents",
  attestations: "/api/attestations",
  trail: (id: number) => `/api/attestations/${id}/trail`,
  disputes: "/api/disputes",
  rogue: (agentId: number) => `/api/agents/${agentId}/rogue`,
  resolve: (disputeId: number) => `/api/disputes/${disputeId}/resolve`,
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      `Cannot reach the orchestrator at ${config.apiUrl}. Is the FastAPI backend running?`
    );
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // Response had no JSON body; the status line is detail enough.
    }
    throw new ApiError(detail, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const httpApi: PraxisApi = {
  mode: "live",
  getStatus: () => request<SystemStatus>(paths.status),
  getAgents: () => request<Agent[]>(paths.agents),
  getAttestations: (limit = 40) => request<Attestation[]>(`${paths.attestations}?limit=${limit}`),
  getTrail: (attestationId) =>
    request<DecisionTrail>(paths.trail(attestationId)).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
  getDisputes: () => request<Dispute[]>(paths.disputes),
  triggerRogue: (agentId) =>
    request<{ attestationId: number }>(paths.rogue(agentId), { method: "POST" }),
  resolveDispute: async (disputeId, upheld) => {
    await request(paths.resolve(disputeId), {
      method: "POST",
      body: JSON.stringify({ upheld }),
    });
  },
  // A live backend has no push channel, so the polling hook drives refreshes.
  subscribe: () => () => {},
};

const demoApi: PraxisApi = {
  mode: "demo",
  getStatus: async () => demoStore.getStatus(),
  getAgents: async () => demoStore.getAgents(),
  getAttestations: async (limit = 40) => demoStore.getAttestations(limit),
  getTrail: async (attestationId) => demoStore.getTrail(attestationId),
  getDisputes: async () => demoStore.getDisputes(),
  triggerRogue: async (agentId) => demoStore.triggerRogue(agentId),
  resolveDispute: async (disputeId, upheld) => demoStore.resolveDispute(disputeId, upheld),
  reset: async () => demoStore.reset(),
  subscribe: (listener) => demoStore.subscribe(listener),
};

export const api: PraxisApi = config.isDemoMode ? demoApi : httpApi;

/** Starts the simulation. No-op against a live backend. */
export function startDemoIfNeeded() {
  if (config.isDemoMode) demoStore.start();
}

/**
 * Recomputes the trail hash client-side and compares it to the commitment.
 * This is the check that makes a revealed trail trustworthy: the dashboard
 * does not take the backend's word for it.
 */
export function verifyTrail(trail: DecisionTrail, committedHash: string): TrailVerification {
  // `source`, `model` and `trailHash` are transport metadata, not part of the
  // committed body — strip them before recomputing.
  const { source, model, trailHash, ...body } = trail;
  void source;
  void model;
  void trailHash;
  const computedHash = hashTrail(body);
  return {
    computedHash,
    committedHash,
    matches: computedHash.toLowerCase() === committedHash.toLowerCase(),
  };
}
