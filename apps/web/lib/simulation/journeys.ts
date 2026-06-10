// ═══════════════════════════════════════════════════════════════
// FROZEN CONTRACT (types + exported array signature).
// Agent B fills the journey data. Do not rename exports.
// ═══════════════════════════════════════════════════════════════

/** One turn inside a scripted agent journey. */
export interface JourneyStep {
  /** Human-readable description shown in the interceptor overlay. */
  label: string;
  /**
   * d-dimensional context vector representing the agent's latent state.
   * d must match BanditConfig.dimensions (12).
   */
  contextVector: number[];
  /** The arm that should win for this step (ground-truth for reward shaping). */
  bestAction: string;
  /**
   * Cold-fetch RTT in milliseconds for the asset that best action would pre-load.
   * Used by latencyModel to compute simulated savings.
   */
  coldFetchMs: number;
}

export interface Journey {
  id: string;
  name: string;
  description: string;
  steps: JourneyStep[];
}

/**
 * Three scripted multi-turn agent journeys pulling toward distinct latent clusters.
 * Agent B implements the data. Dimensions: d=12.
 */
export const journeys: Journey[] = [
  // Agent B: fill with Data Analysis, Code Generation, Customer Support journeys
];
