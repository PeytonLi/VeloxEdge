// ═══════════════════════════════════════════════════════════════
// FROZEN CONTRACT — Agent B fills implementation.
// ═══════════════════════════════════════════════════════════════

/** Pre-defined latency constants for the simulated edge model. */
export const EDGE_HIT_MS = 5;    // cache hit at Akamai edge node
export const COLD_FETCH_MS = 800; // cold-fetch round-trip to origin

export interface LatencyResult {
  /** Whether the bandit predicted this step correctly (action matched bestAction). */
  cacheHit: boolean;
  /** Simulated latency experienced in ms. */
  latencyMs: number;
  /** Latency saved vs naive cache (0 if cold fetch). */
  savedMs: number;
  /**
   * Normalized reward ∈ [0, 1] for the bandit update.
   * 1.0 = full edge hit saving max RTT, 0.0 = cold fetch.
   */
  reward: number;
}

/**
 * Compute latency result for one bandit step.
 *
 * @param predictedAction - action chosen by LinUCBEngine
 * @param bestAction      - ground-truth best action for this step
 * @param coldFetchMs     - the asset's cold-fetch RTT from the journey step
 */
export function computeLatency(
  predictedAction: string,
  bestAction: string,
  coldFetchMs: number,
): LatencyResult {
  throw new Error('Not implemented — Agent B');
}

/** Running statistics accumulator for Section A counters. */
export interface LatencyStats {
  totalSteps: number;
  cacheHits: number;
  coldFetches: number;
  totalSavedMs: number;
  naiveTotalMs: number;
  veloxTotalMs: number;
}

export function emptyStats(): LatencyStats {
  return {
    totalSteps: 0,
    cacheHits: 0,
    coldFetches: 0,
    totalSavedMs: 0,
    naiveTotalMs: 0,
    veloxTotalMs: 0,
  };
}

export function accumulateStats(stats: LatencyStats, result: LatencyResult): LatencyStats {
  throw new Error('Not implemented — Agent B');
}

/** Percentage latency improvement of VeloxEdge vs naive cache (0–100). */
export function improvementPct(stats: LatencyStats): number {
  if (stats.naiveTotalMs === 0) return 0;
  return ((stats.naiveTotalMs - stats.veloxTotalMs) / stats.naiveTotalMs) * 100;
}
