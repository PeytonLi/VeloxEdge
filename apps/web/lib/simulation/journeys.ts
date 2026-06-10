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

const DIMENSIONS = 12;

const ACTIONS = {
  tool: "TOOL_CONTEXT",
  memory: "EDGEKV_MEMORY",
  vector: "VECTOR_WEIGHTS",
  noop: "NO_OP",
} as const;

type ActionName = (typeof ACTIONS)[keyof typeof ACTIONS];

const ACTION_FEATURES: Record<ActionName, Array<[number, number]>> = {
  TOOL_CONTEXT: [
    [3, 0.92],
    [7, 0.34],
    [8, 0.56],
  ],
  EDGEKV_MEMORY: [
    [4, 0.9],
    [7, 0.22],
    [9, 0.62],
  ],
  VECTOR_WEIGHTS: [
    [5, 0.94],
    [7, 0.28],
    [10, 0.68],
  ],
  NO_OP: [
    [6, 0.88],
    [7, 0.08],
    [11, 0.48],
  ],
};

function normalize(values: number[]): number[] {
  const magnitude =
    Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => Number((value / magnitude).toFixed(4)));
}

function contextVector(
  journeyCluster: 0 | 1 | 2,
  action: ActionName,
  turn: number,
  urgency: number,
): number[] {
  const vector = new Array(DIMENSIONS).fill(0.035);

  // Dimensions 0–2 identify the broad journey cluster.
  vector[journeyCluster] = 0.96;

  // Dimensions 3–6 encode which kind of asset the next agent step needs.
  for (const [dimension, weight] of ACTION_FEATURES[action]) {
    vector[dimension] += weight;
  }

  // Dimension 7 is a coarse cold-fetch pressure signal; dimension 11 is small
  // deterministic prompt drift to keep every turn unique without randomness.
  vector[7] += urgency;
  vector[11] += (((journeyCluster + 1) * 13 + turn * 17) % 19) / 100;

  return normalize(vector);
}

/**
 * Three scripted multi-turn agent journeys pulling toward distinct latent clusters.
 * Agent B implements the data. Dimensions: d=12.
 */
export const journeys: Journey[] = [
  {
    id: "data-analysis",
    name: "Data Analysis Agent",
    description:
      "A metrics agent mutates SQL, notebook, and chart prompts while chasing a revenue anomaly.",
    steps: [
      {
        label: "Inspect warehouse schema and metric lineage",
        contextVector: contextVector(0, ACTIONS.tool, 0, 0.42),
        bestAction: ACTIONS.tool,
        coldFetchMs: 920,
      },
      {
        label: "Recall analyst notebook memory and cohort filters",
        contextVector: contextVector(0, ACTIONS.memory, 1, 0.31),
        bestAction: ACTIONS.memory,
        coldFetchMs: 760,
      },
      {
        label: "Fetch semantic KPI examples for similar anomalies",
        contextVector: contextVector(0, ACTIONS.vector, 2, 0.38),
        bestAction: ACTIONS.vector,
        coldFetchMs: 840,
      },
      {
        label: "Join CSV sample against the SQL warehouse extract",
        contextVector: contextVector(0, ACTIONS.tool, 3, 0.45),
        bestAction: ACTIONS.tool,
        coldFetchMs: 890,
      },
      {
        label: "Recall preferred chart style and fiscal calendar",
        contextVector: contextVector(0, ACTIONS.memory, 4, 0.29),
        bestAction: ACTIONS.memory,
        coldFetchMs: 720,
      },
      {
        label: "Draft final explanation from local evidence",
        contextVector: contextVector(0, ACTIONS.noop, 5, 0.12),
        bestAction: ACTIONS.noop,
        coldFetchMs: 260,
      },
    ],
  },
  {
    id: "code-generation",
    name: "Code Generation Agent",
    description:
      "A coding agent bounces between repo graph, compiler state, related tests, and reviewer memory.",
    steps: [
      {
        label: "Load repository graph, package scripts, and public APIs",
        contextVector: contextVector(1, ACTIONS.tool, 0, 0.4),
        bestAction: ACTIONS.tool,
        coldFetchMs: 880,
      },
      {
        label: "Recall previous refactor constraints from session memory",
        contextVector: contextVector(1, ACTIONS.memory, 1, 0.28),
        bestAction: ACTIONS.memory,
        coldFetchMs: 710,
      },
      {
        label: "Fetch embeddings for related files and failing tests",
        contextVector: contextVector(1, ACTIONS.vector, 2, 0.44),
        bestAction: ACTIONS.vector,
        coldFetchMs: 940,
      },
      {
        label: "Preload TypeScript diagnostics and code index",
        contextVector: contextVector(1, ACTIONS.tool, 3, 0.37),
        bestAction: ACTIONS.tool,
        coldFetchMs: 860,
      },
      {
        label: "Retrieve reviewer preference memory and naming rules",
        contextVector: contextVector(1, ACTIONS.memory, 4, 0.25),
        bestAction: ACTIONS.memory,
        coldFetchMs: 650,
      },
      {
        label: "Draft final patch plan locally",
        contextVector: contextVector(1, ACTIONS.noop, 5, 0.1),
        bestAction: ACTIONS.noop,
        coldFetchMs: 240,
      },
    ],
  },
  {
    id: "customer-support",
    name: "Customer Support Agent",
    description:
      "A support agent routes billing, SLA, sentiment, and policy retrieval without exact prompt reuse.",
    steps: [
      {
        label: "Load CRM tool schema and escalation playbook",
        contextVector: contextVector(2, ACTIONS.tool, 0, 0.36),
        bestAction: ACTIONS.tool,
        coldFetchMs: 820,
      },
      {
        label: "Recall account tier, SLA, and conversation history",
        contextVector: contextVector(2, ACTIONS.memory, 1, 0.46),
        bestAction: ACTIONS.memory,
        coldFetchMs: 930,
      },
      {
        label: "Fetch policy retrieval vectors for refunds and credits",
        contextVector: contextVector(2, ACTIONS.vector, 2, 0.33),
        bestAction: ACTIONS.vector,
        coldFetchMs: 790,
      },
      {
        label: "Preload billing adjustment tool context",
        contextVector: contextVector(2, ACTIONS.tool, 3, 0.41),
        bestAction: ACTIONS.tool,
        coldFetchMs: 870,
      },
      {
        label: "Recall prior sentiment and promised resolution",
        contextVector: contextVector(2, ACTIONS.memory, 4, 0.43),
        bestAction: ACTIONS.memory,
        coldFetchMs: 910,
      },
      {
        label: "Compose final empathetic response locally",
        contextVector: contextVector(2, ACTIONS.noop, 5, 0.09),
        bestAction: ACTIONS.noop,
        coldFetchMs: 230,
      },
    ],
  },
];
