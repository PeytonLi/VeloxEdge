import type { EngineSnapshot } from "@veloxedge/bandit-engine";
import type { InterceptorEvent } from "@/hooks/useVeloxEngine";
import type { Journey, LatencyStats } from "@/lib/simulation";

export const DEFAULT_DIMENSIONS = 12;
export const DEFAULT_ALPHA = 1.05;
export const FALLBACK_EDGE_HIT_MS = 5;

export const ACTIONS = [
  "TOOL_CONTEXT",
  "EDGEKV_MEMORY",
  "VECTOR_WEIGHTS",
  "NO_OP",
] as const;

export type DemoActionName = (typeof ACTIONS)[number];

export interface ActionCopy {
  label: string;
  shortLabel: string;
  interceptor: string;
  asset: string;
  description: string;
  accent: string;
  softAccent: string;
}

export const ACTION_COPY: Record<string, ActionCopy> = {
  TOOL_CONTEXT: {
    label: "Tool Context",
    shortLabel: "Tools",
    interceptor: "Pre-fetch DB Core Schema",
    asset: "tool_manifest.sql + parser hints",
    description:
      "Warms tool schemas and invocation context before the next agent call.",
    accent: "#67e8f9",
    softAccent: "rgba(103, 232, 249, 0.18)",
  },
  EDGEKV_MEMORY: {
    label: "EdgeKV Memory",
    shortLabel: "Memory",
    interceptor: "Hydrate Session Memory Shard",
    asset: "edgekv://session/memory-shard",
    description:
      "Pulls sticky user and workflow state into the nearest edge node.",
    accent: "#f59e0b",
    softAccent: "rgba(245, 158, 11, 0.2)",
  },
  VECTOR_WEIGHTS: {
    label: "Vector Weights",
    shortLabel: "Vectors",
    interceptor: "Stream Vector Index Weights",
    asset: "ann_weights.cluster.bin",
    description:
      "Stages retrieval centroids for the likely next latent-space cluster.",
    accent: "#a3e635",
    softAccent: "rgba(163, 230, 53, 0.18)",
  },
  NO_OP: {
    label: "No-op Guard",
    shortLabel: "No-op",
    interceptor: "Hold Edge Budget",
    asset: "no speculative pull",
    description:
      "Declines a prefetch when confidence is lower than the bandwidth budget.",
    accent: "#94a3b8",
    softAccent: "rgba(148, 163, 184, 0.14)",
  },
};

export const VIZ_DIMENSIONS = [
  "intent",
  "tool",
  "schema",
  "memory",
  "retrieval",
  "tokens",
  "recency",
  "risk",
  "latency",
  "persona",
  "chain",
  "budget",
];

const fallbackVector = (hot: number, offset = 0) =>
  Array.from({ length: DEFAULT_DIMENSIONS }, (_, index) => {
    const wave = Math.sin((index + 1) * (offset + 1.7)) * 0.18;
    const cluster =
      index % 4 === hot ? 0.82 : index % 3 === hot % 3 ? 0.34 : 0.12;
    return Number((cluster + wave).toFixed(3));
  });

export const DEMO_JOURNEYS: Journey[] = [
  {
    id: "data-analysis",
    name: "Data Analysis",
    description:
      "The agent keeps mutating SQL and chart prompts while chasing revenue drift.",
    steps: [
      {
        label: "Parse CFO question about Q4 churn by region",
        contextVector: fallbackVector(0, 0),
        bestAction: "TOOL_CONTEXT",
        coldFetchMs: 860,
      },
      {
        label: "Ask warehouse for schema + row statistics",
        contextVector: fallbackVector(0, 1),
        bestAction: "TOOL_CONTEXT",
        coldFetchMs: 910,
      },
      {
        label: "Retrieve prior dashboard metric definitions",
        contextVector: fallbackVector(1, 2),
        bestAction: "EDGEKV_MEMORY",
        coldFetchMs: 780,
      },
      {
        label: "Re-rank anomaly slices for the final chart",
        contextVector: fallbackVector(2, 3),
        bestAction: "VECTOR_WEIGHTS",
        coldFetchMs: 820,
      },
    ],
  },
  {
    id: "code-generation",
    name: "Code Generation",
    description:
      "A coding agent loops through repo search, tests, dependency facts, and patches.",
    steps: [
      {
        label: "Locate auth middleware and route handlers",
        contextVector: fallbackVector(2, 4),
        bestAction: "VECTOR_WEIGHTS",
        coldFetchMs: 760,
      },
      {
        label: "Load package graph and test runner commands",
        contextVector: fallbackVector(0, 5),
        bestAction: "TOOL_CONTEXT",
        coldFetchMs: 840,
      },
      {
        label: "Hydrate prior failing test trace",
        contextVector: fallbackVector(1, 6),
        bestAction: "EDGEKV_MEMORY",
        coldFetchMs: 735,
      },
      {
        label: "Prepare patch context for the next edit",
        contextVector: fallbackVector(2, 7),
        bestAction: "VECTOR_WEIGHTS",
        coldFetchMs: 805,
      },
    ],
  },
  {
    id: "support-agent",
    name: "Customer Support",
    description:
      "Support automation pivots between account memory, policy tools, and KB search.",
    steps: [
      {
        label: "Recognize refund escalation intent",
        contextVector: fallbackVector(1, 8),
        bestAction: "EDGEKV_MEMORY",
        coldFetchMs: 720,
      },
      {
        label: "Warm policy checker and entitlement tools",
        contextVector: fallbackVector(0, 9),
        bestAction: "TOOL_CONTEXT",
        coldFetchMs: 790,
      },
      {
        label: "Fetch similar resolution embeddings",
        contextVector: fallbackVector(2, 10),
        bestAction: "VECTOR_WEIGHTS",
        coldFetchMs: 870,
      },
      {
        label: "Store final disposition for the next turn",
        contextVector: fallbackVector(1, 11),
        bestAction: "EDGEKV_MEMORY",
        coldFetchMs: 760,
      },
    ],
  },
];

/** Narrative prompts that simulate a real human working through each journey.
 *  Each array tells a story — getting stuck, debugging, pivoting, finishing.
 *  The continuous loop cycles through these, updating the textarea as it goes. */
export const NARRATIVE_PROMPTS: Record<string, string[]> = {
  "data-analysis": [
    "I need to investigate the Q4 churn spike in APAC. Pull the warehouse schema and table stats first.",
    "Got the schema. Now run a query for all churned enterprise accounts by region over the last 6 months.",
    "Hmm, the numbers don't match what the CFO showed. Cross-reference with the billing system's account statuses.",
    "Found it — billing has 47 accounts marked 'active' that the warehouse shows as churned. Need to reconcile.",
    "OK reconciled. Now pull the customer health scores for those accounts. I want to see if there's a pattern.",
    "Interesting — high-value accounts with health scores below 0.3 are churning at 4x the rate. That's the signal.",
    "Search the vector index for similar churn patterns from previous quarters. I want the top 10 semantic matches.",
    "The pattern matches Q2 2023 almost exactly. What remediation steps worked back then? Pull that playbook.",
    "Got the playbook. Now I need to build the executive dashboard with cohort retention curves for the board.",
    "Dashboard is rendering but the CFO wants APAC broken down by country too. Pull the geo-dimension tables.",
    "Actually, hold off on that — the data pipeline just errored. Let me check the ETL logs first.",
    "Pipeline is back up. Now finalize the dashboard and pre-fetch the weekly report template for Monday.",
  ],
  "code-generation": [
    "I need to add rate limiting to the auth middleware. Show me the current implementation in the codebase.",
    "Found the Express middleware. But there's also a GraphQL endpoint — does it go through the same auth layer?",
    "It doesn't. The GraphQL resolver has its own auth. I need to add rate limiting there too. Find the resolver files.",
    "OK I see the pattern now. Let me check if there's an existing rate limit implementation in this monorepo.",
    "Found one in the payments service — it uses a token bucket. That's better than what I was going to write.",
    "Adapted the token bucket for auth. Tests are passing locally but the CI is failing with a Redis connection error.",
    "The test is sharing Redis state across test cases. Need to fix the isolation — pull the test helper patterns.",
    "Fixed the tests. But now I realize the rate limit config should be per-tenant. Find the multi-tenant config schema.",
    "The multi-tenant config needs a database migration. Let me find the migration guide and the existing schema files.",
    "Migration is ready. One last thing — add monitoring metrics. Find the observability patterns used elsewhere.",
    "Actually, I think there's a memory leak in the token bucket. Let me debug the counter reset logic.",
    "False alarm — it was the test fixture. Everything is green. Pre-fetch the deployment pipeline config for release.",
  ],
  "support-agent": [
    "Customer 4582 is requesting a full refund for their annual plan. Pull their account history and subscription details.",
    "They've been a premium customer for 3 years but filed 4 complaints this month. Something changed recently.",
    "Check the refund policy for annual plans. I need the exact terms — proration rules, deadlines, exception criteria.",
    "Policy says prorated refund within 60 days. They're at day 73. But there's an exception clause for service outages.",
    "Search the knowledge base for similar refund exception cases from the last 12 months.",
    "Found 3 similar cases — two were denied, one was approved by manager override due to a billing error on our side.",
    "This customer also had a billing error last month. That strengthens their case. I'm going to escalate to a manager.",
    "While the escalation is pending, pre-fetch the customer's full interaction history for the manager review.",
    "Manager needs the legal terms for contract exceptions. Pull those from the policy documents repository.",
    "Manager approved the exception. Now I need to process the refund and update the CRM with the resolution notes.",
    "The CRM sync failed — there's a conflict because the billing system still shows the subscription as active.",
    "Reconciled the records. Now send the confirmation email and update the customer health score to reflect the resolution.",
  ],
};

/** Get the next narrative prompt for a journey, cycling through the array. */
export function getNarrativePrompt(
  journeyId: string,
  stepIndex: number,
): string {
  const prompts = NARRATIVE_PROMPTS[journeyId];
  if (!prompts || prompts.length === 0) {
    return "Continue the current workflow task.";
  }
  return prompts[stepIndex % prompts.length];
}

export interface TimelinePoint {
  step: number;
  naive: number;
  velox: number;
  saved: number;
  cacheHits: number;
}

export interface ConvergencePoint {
  step: number;
  tool: number;
  memory: number;
  vector: number;
  noOp: number;
}

export function actionCopy(action?: string): ActionCopy {
  if (action && ACTION_COPY[action]) return ACTION_COPY[action];
  return {
    label: action ? action.replaceAll("_", " ") : "Unknown Arm",
    shortLabel: action ? action.slice(0, 8) : "Arm",
    interceptor: action
      ? `Pre-fetch ${action.replaceAll("_", " ")}`
      : "Awaiting UCB decision",
    asset: "pending asset route",
    description: "External agent arm supplied by the simulation layer.",
    accent: "#67e8f9",
    softAccent: "rgba(103, 232, 249, 0.16)",
  };
}

export function createEmptyStats(): LatencyStats {
  return {
    totalSteps: 0,
    cacheHits: 0,
    coldFetches: 0,
    totalSavedMs: 0,
    naiveTotalMs: 0,
    veloxTotalMs: 0,
  };
}

export function calculateImprovement(stats: LatencyStats): number {
  if (stats.naiveTotalMs <= 0) return 0;
  return ((stats.naiveTotalMs - stats.veloxTotalMs) / stats.naiveTotalMs) * 100;
}

export function formatMs(value: number): string {
  if (!Number.isFinite(value)) return "0ms";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Math.max(0, value),
  );
}

export function classifyPromptAction(prompt: string): string {
  const normalized = prompt.toLowerCase();
  if (
    /schema|sql|tool|api|function|warehouse|test|runner|route/.test(normalized)
  )
    return "TOOL_CONTEXT";
  if (
    /memory|customer|account|session|history|prior|refund|policy/.test(
      normalized,
    )
  )
    return "EDGEKV_MEMORY";
  if (
    /vector|search|embed|retrieve|similar|rank|cluster|index|knowledge/.test(
      normalized,
    )
  )
    return "VECTOR_WEIGHTS";
  return normalized.trim().length < 6 ? "NO_OP" : "VECTOR_WEIGHTS";
}

export function createDemoSnapshot(
  alpha = DEFAULT_ALPHA,
  tick = 0,
  activeAction = "TOOL_CONTEXT",
): EngineSnapshot {
  const aInvDiag: Record<string, number[]> = {};
  const thetaHat: Record<string, number[]> = {};
  const lastUcb = ACTIONS.map((action, actionIndex) => {
    const visitedDrop =
      action === activeAction ? 0.32 : 0.08 * ((tick + actionIndex) % 3);
    const baseVariance = Math.max(0.06, 1.12 - tick * 0.055 - visitedDrop);
    const diag = Array.from(
      { length: DEFAULT_DIMENSIONS },
      (_, dimensionIndex) => {
        const amberPocket = dimensionIndex % 4 === actionIndex ? 0.28 : 0;
        const ripple =
          Math.sin((dimensionIndex + 1) * (actionIndex + 2) + tick * 0.8) *
          0.12;
        return Number(
          Math.max(0.04, baseVariance + amberPocket + ripple).toFixed(3),
        );
      },
    );

    const theta = Array.from(
      { length: DEFAULT_DIMENSIONS },
      (_, dimensionIndex) => {
        const direction =
          action === activeAction ? 1 : action === "NO_OP" ? -0.2 : 0.45;
        const wave =
          Math.cos((tick + 1) * 0.42 + dimensionIndex * 0.61 + actionIndex) *
          0.09;
        return Number(
          (direction * Math.min(0.92, tick * 0.045 + 0.2) + wave).toFixed(3),
        );
      },
    );

    aInvDiag[action] = diag;
    thetaHat[action] = theta;

    const variance = diag.reduce((sum, value) => sum + value, 0) / diag.length;
    const expectedReward =
      theta.reduce((sum, value) => sum + value, 0) / theta.length;
    const explorationBonus = alpha * Math.sqrt(Math.max(0, variance)) * 0.42;

    return {
      action,
      expectedReward: Number(expectedReward.toFixed(3)),
      explorationBonus: Number(explorationBonus.toFixed(3)),
      ucbValue: Number((expectedReward + explorationBonus).toFixed(3)),
    };
  });

  lastUcb.sort((left, right) => right.ucbValue - left.ucbValue);

  return { aInvDiag, thetaHat, lastUcb };
}

export function snapshotToConvergencePoint(
  snapshot: EngineSnapshot,
  step: number,
): ConvergencePoint {
  const magnitude = (action: string) => {
    const theta = snapshot.thetaHat[action] ?? [];
    if (theta.length === 0) return 0;
    return Number(
      (
        theta.reduce((sum, value) => sum + Math.abs(value), 0) / theta.length
      ).toFixed(3),
    );
  };

  return {
    step,
    tool: magnitude("TOOL_CONTEXT"),
    memory: magnitude("EDGEKV_MEMORY"),
    vector: magnitude("VECTOR_WEIGHTS"),
    noOp: magnitude("NO_OP"),
  };
}

export function buildFallbackEvents(
  tick: number,
  action: string,
  label: string,
  cacheHit: boolean,
): InterceptorEvent[] {
  const copy = actionCopy(action);
  const base = tick * 31;
  const status = cacheHit
    ? "Local Cache Populated @ Akamai Edge"
    : "Origin Cold Pull Logged";

  const ev = (offset: number, msg: string): InterceptorEvent => ({
    timestamp: base + offset,
    message: `[${String(base + offset).padStart(3, "0")}ms] ${msg}`,
    action,
    cacheHit,
  });

  return [
    ev(0, "Logit Stream Arrived → token buffer locked"),
    ev(2, `Naive Cache Probe → ${label}`),
    ev(5, "State Vector Extracted → d=12 latent trace locked"),
    ev(8, "Covariance Matrix A⁻¹ Loaded → ridge-regularised"),
    ev(11, "LinUCB Argmax — computing per-arm UCB:"),
    ev(12, "  TOOL_CONTEXT           θ̂ᵀx=0.4211  ασ=0.1832  UCB=0.6043"),
    ev(13, "▶ EDGEKV_MEMORY          θ̂ᵀx=0.5198  ασ=0.2105  UCB=0.7303"),
    ev(14, "  VECTOR_WEIGHTS         θ̂ᵀx=0.3856  ασ=0.1678  UCB=0.5534"),
    ev(15, "  NO_OP                  θ̂ᵀx=0.2100  ασ=0.3100  UCB=0.5200"),
    ev(17, `▶ Selected: ${copy.interceptor}`),
    ev(19, "LOCAL measured cache → speculative pre-fetch dispatched"),
    ev(22, "Agent Request Intercepted → context_key"),
    ev(25, `Edge Fill → ${status}`),
    ev(28, "Reward Signal → r=0.870  (∈ [0,1])"),
    ev(30, "Ridge Update → Aₐ ← Aₐ + xxᵀ  |  bₐ ← bₐ + r·x"),
    ev(32, "θ̂ₐ Re-estimated → next prediction ready"),
  ];
}

export function initialTimeline(): TimelinePoint[] {
  return [
    { step: 0, naive: 0, velox: 0, saved: 0, cacheHits: 0 },
    { step: 1, naive: 840, velox: 840, saved: 0, cacheHits: 0 },
    { step: 2, naive: 1660, velox: 886, saved: 774, cacheHits: 1 },
    { step: 3, naive: 2480, velox: 931, saved: 1549, cacheHits: 2 },
    { step: 4, naive: 3310, velox: 981, saved: 2329, cacheHits: 3 },
  ];
}

export function initialConvergence(): ConvergencePoint[] {
  return Array.from({ length: 7 }, (_, index) => {
    const snapshot = createDemoSnapshot(
      DEFAULT_ALPHA,
      index + 1,
      ACTIONS[index % ACTIONS.length],
    );
    return snapshotToConvergencePoint(snapshot, index);
  });
}

export function deriveTimelineFromStats(stats: LatencyStats): TimelinePoint[] {
  if (stats.totalSteps <= 0) return initialTimeline();
  const steps = Math.max(1, stats.totalSteps);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const ratio = index / steps;
    return {
      step: index,
      naive: Math.round(stats.naiveTotalMs * ratio),
      velox: Math.round(stats.veloxTotalMs * ratio),
      saved: Math.round(stats.totalSavedMs * ratio),
      cacheHits: Math.round(stats.cacheHits * ratio),
    };
  });
}
