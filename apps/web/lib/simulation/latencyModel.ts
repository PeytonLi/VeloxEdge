// ═══════════════════════════════════════════════════════════════
// FROZEN CONTRACT — Agent B fills implementation.
// ═══════════════════════════════════════════════════════════════

/** Pre-defined latency constants for the simulated edge model. */
export const EDGE_HIT_MS = 5; // cache hit at Akamai edge node
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

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
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
  const coldMs = Math.max(
    EDGE_HIT_MS,
    finitePositive(coldFetchMs, COLD_FETCH_MS),
  );
  // NO_OP means "don't pre-fetch anything" — it can never be a cache hit
  const cacheHit =
    predictedAction === bestAction && predictedAction !== "NO_OP";
  const latencyMs = cacheHit ? EDGE_HIT_MS : coldMs;
  const savedMs = cacheHit ? Math.max(0, coldMs - EDGE_HIT_MS) : 0;
  const maxSavings = Math.max(1, coldMs - EDGE_HIT_MS);

  return {
    cacheHit,
    latencyMs: roundMs(latencyMs),
    savedMs: roundMs(savedMs),
    reward: clamp01(savedMs / maxSavings),
  };
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

export function accumulateStats(
  stats: LatencyStats,
  result: LatencyResult,
): LatencyStats {
  const naiveStepMs = result.latencyMs + result.savedMs;

  return {
    totalSteps: stats.totalSteps + 1,
    cacheHits: stats.cacheHits + (result.cacheHit ? 1 : 0),
    coldFetches: stats.coldFetches + (result.cacheHit ? 0 : 1),
    totalSavedMs: roundMs(stats.totalSavedMs + result.savedMs),
    naiveTotalMs: roundMs(stats.naiveTotalMs + naiveStepMs),
    veloxTotalMs: roundMs(stats.veloxTotalMs + result.latencyMs),
  };
}

/** Percentage latency improvement of VeloxEdge vs naive cache (0–100). */
export function improvementPct(stats: LatencyStats): number {
  if (stats.naiveTotalMs === 0) return 0;
  return ((stats.naiveTotalMs - stats.veloxTotalMs) / stats.naiveTotalMs) * 100;
}
