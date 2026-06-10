// ═══════════════════════════════════════════════════════════════
// FROZEN CONTRACT — Agent 0 sealed this file.
// Do not modify signatures. Agent A fills in implementations only.
// ═══════════════════════════════════════════════════════════════

/** Configuration for the LinUCB bandit engine. */
export interface BanditConfig {
  /** Dimension d of the context embedding vectors. */
  dimensions: number;
  /** Exploration-exploitation trade-off parameter α > 0. */
  alpha: number;
  /** Names of the inference pre-fetch arms. */
  actions: string[];
}

/** Per-arm UCB decomposition exposed for dashboard visualization. */
export interface UcbBreakdown {
  action: string;
  expectedReward: number;
  explorationBonus: number;
  ucbValue: number;
}

/** Snapshot of internal state for dashboard heatmap / convergence charts. */
export interface EngineSnapshot {
  /** Diagonal of A⁻¹ for each arm — proxy for per-arm variance. */
  aInvDiag: Record<string, number[]>;
  /** Current weight estimates θ̂ for each arm. */
  thetaHat: Record<string, number[]>;
  /** UCB breakdown from the most recent predictNextAction() call. */
  lastUcb: UcbBreakdown[];
}

/** A single step result returned by the engine. */
export interface PredictionResult {
  action: string;
  ucbBreakdown: UcbBreakdown[];
}
