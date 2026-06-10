// ═══════════════════════════════════════════════════════════════
// Barrel export — do not change.
// ═══════════════════════════════════════════════════════════════

export { journeys } from './journeys';
export type { Journey, JourneyStep } from './journeys';

export { embed } from './embedding';

export {
  computeLatency,
  accumulateStats,
  emptyStats,
  improvementPct,
  EDGE_HIT_MS,
  COLD_FETCH_MS,
} from './latencyModel';
export type { LatencyResult, LatencyStats } from './latencyModel';

export { NaiveStringCache } from './naiveCache';
