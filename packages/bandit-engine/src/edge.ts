// ═══════════════════════════════════════════════════════════════
// FROZEN EDGE CONTRACT — Agent 0 sealed this file.
// Do not redefine these DTOs in worker, emulator, route, or client code.
// ═══════════════════════════════════════════════════════════════

import type { UcbBreakdown } from "./types";

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

/** Predict the next pre-fetch action for a session and context vector. */
export interface EdgePredictRequest extends EdgeSessionRequest {
  contextVector: number[];
}

/** Apply an observed reward for a previously selected action. */
export interface EdgeUpdateRequest extends EdgeSessionRequest {
  action: string;
  contextVector: number[];
  reward: number;
}

/** Common response payload returned by edge predict/update endpoints. */
export interface EdgeResponseBase {
  sessionId: string;
  action: string;
  ucbBreakdown: UcbBreakdown[];
  computeMicros: number;
}

export interface EdgePredictResponse extends EdgeResponseBase {}

export interface EdgeUpdateResponse extends EdgeResponseBase {}
