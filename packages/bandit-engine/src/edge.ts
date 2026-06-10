// ═══════════════════════════════════════════════════════════════
// FROZEN EDGE CONTRACT — Phase 3 Agent 0 sealed this file.
// Do not redefine these DTOs in worker, emulator, route, or client code.
// ═══════════════════════════════════════════════════════════════

import type { UcbBreakdown } from "./types";

export const VELOX_EDGE_SECRET_HEADER = "x-velox-edge-secret";
export const VELOX_ASSET_TTL_SECONDS = 60;
export const VELOX_PENDING_TTL_SECONDS = 300;
export const VELOX_STATE_TTL_SECONDS = 60 * 60;

/** Serializable LinUCB state persisted per session in EdgeKV. */
export interface SerializedEngineState {
  /** Dimension d of every context vector and per-arm matrix. */
  dimensions: number;
  /** Exploration-exploitation trade-off parameter α. */
  alpha: number;
  /** Names of the inference pre-fetch arms, in deterministic order. */
  actions: string[];
  /** Per-arm d×d covariance matrix A_a = DᵀD + I. */
  A: Record<string, number[][]>;
  /** Per-arm d×1 reward accumulator vector b_a. */
  b: Record<string, number[]>;
}

/** Config required to create a fresh edge-side engine when no state exists. */
export interface EdgeEngineConfig {
  dimensions: number;
  alpha: number;
  actions: string[];
}

/** Common session-scoped request fields for EdgeWorker calls. */
export interface EdgeSessionRequest extends EdgeEngineConfig {
  sessionId: string;
}

/** Details for the cache prefetch side effect coupled to a prediction. */
export interface PrefetchOutcome {
  executed: boolean;
  key: string;
  originMs: number | null;
  cacheWritten: boolean;
}

/** Pending attribution record linking a prediction to the later asset request. */
export interface PendingPrediction {
  sessionId: string;
  step: number;
  key: string;
  action: string;
  contextVector: number[];
  prefetchedAt: number;
}

/** Real asset metadata used by the origin, worker, and emulator. */
export interface AssetDescriptor {
  key: string;
  bytes?: string;
  ref?: string;
  coldOriginMs: number;
  contentType?: string;
}

/** Predict the next pre-fetch action for a session and context vector. */
export interface EdgePredictRequest extends EdgeSessionRequest {
  contextVector: number[];
  /** Optional caller-supplied sequence number for prediction attribution. */
  step?: number;
}

/** Apply an observed reward for a previously selected action. Legacy Phase 2 path. */
export interface EdgeUpdateRequest extends EdgeSessionRequest {
  action: string;
  contextVector: number[];
  reward: number;
}

/** Resolve a real requested asset and update the bandit from measured hit/miss latency. */
export interface EdgeResolveRequest {
  sessionId: string;
  config: EdgeEngineConfig;
  requestedKey: string;
  contextVector: number[];
  step?: number;
}

/** Common response payload returned by legacy predict/update endpoints. */
export interface EdgeResponseBase {
  sessionId: string;
  action: string;
  ucbBreakdown: UcbBreakdown[];
  computeMicros: number;
}

export interface EdgePredictResponse extends EdgeResponseBase {
  predictedKey: string;
  prefetch: PrefetchOutcome;
}

export interface EdgeUpdateResponse extends EdgeResponseBase {}

export interface EdgeResolveResponse {
  sessionId: string;
  requestedKey: string;
  action: string;
  cacheHit: boolean;
  latencyMs: number;
  reward: number;
  ucbBreakdown: UcbBreakdown[];
  computeMicros: number;
}
