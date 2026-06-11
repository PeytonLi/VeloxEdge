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
    // TOOL_CONTEXT — schema, sql, warehouse, api, function, tool
    "Pull the full warehouse schema for the revenue tables and index the column stats.",
    "Run a SQL query against the churn funnel — segment by region, plan tier, and cohort month.",
    "The ETL pipeline for daily metrics just broke. Check the runner logs and restart the failed functions.",
    "I need the Stripe billing API schema to cross-reference actual MRR against warehouse projections.",
    "Benchmark the query tool against last quarter's run — is the new index actually helping?",
    // EDGEKV_MEMORY — customer, account, session, history, prior, refund, policy, memory
    "Load the session history for the top 20 enterprise accounts flagged in the churn report.",
    "What was the prior quarter's churn forecast? Compare it to actuals from the memory cache.",
    "A customer just disputed their last three invoices. Pull the full account timeline and refund policy.",
    "The board wants retention metrics by account age cohort. Grab the historical cohort assignments from session data.",
    "Recall the analyst notebook from last month — it had a great segmentation model for at-risk accounts.",
    // VECTOR_WEIGHTS — vector, search, embed, retrieve, similar, rank, cluster, index, knowledge
    "Search the vector index for customers with similar usage decay patterns over the last 90 days.",
    "Run a semantic similarity search across all support tickets — rank the top complaints by cluster.",
    "Retrieve the nearest-neighbor cohorts from the embedding index for the high-churn segment.",
    "Cluster the churned accounts by feature usage vectors and rank the top loss drivers.",
    "Embed the new fiscal calendar into the knowledge index so reports auto-align to quarters.",
    "Do a cross-company similarity search — do our churn patterns match any public benchmark datasets?",
    // NO_OP or short — brief checks, summaries, confirmations
    "Summarize the findings so far and prepare the executive briefing.",
    "Done with the analysis. Push the final dashboard and notify the CFO.",
    "Wait — double-check the pipeline status before we send anything out.",
    "Final review. Anything I missed?",
  ],
  "code-generation": [
    // TOOL_CONTEXT
    "Find the Express middleware stack — I need to trace the full request pipeline from route to handler.",
    "Pull the TypeScript API types for the payments service. The function signatures need updating.",
    "The test runner keeps flaking on CI. Check the Jest config and the Docker Compose setup for the test DB.",
    "We're migrating from REST to GraphQL. Map out every existing route that touches the user model.",
    "Audit the npm packages for vulnerabilities. Run the security scan tool against the full dependency tree.",
    // EDGEKV_MEMORY
    "What was the prior refactor approach for the auth module? I know we tried this before — check session notes.",
    "The reviewer keeps rejecting my PR for the same reason. Pull their comment history to understand the pattern.",
    "I need the multi-tenant account config from the last deployment. It's in the ops memory somewhere.",
    "Recall the coding standards document from the onboarding session — am I breaking any rules here?",
    "There was a memory leak reported in this exact module six months ago. Find the prior incident report.",
    // VECTOR_WEIGHTS
    "Search for semantically similar code across the monorepo — I want to deduplicate the rate limit logic.",
    "Embed the PR review comments into the vector index so future reviewers can retrieve relevant past feedback.",
    "Retrieve the top 10 most similar test files to the one I'm writing. I want to match the patterns exactly.",
    "Rank all modules by bug density using the historical issue tracker data. Which files need the most love?",
    "Cluster the failing E2E tests by error message similarity. I bet they all share a root cause.",
    "Index the entire codebase documentation into the knowledge base so I can semantic-search for answers.",
    // NO_OP / short
    "Am I overthinking this? Let me take a step back.",
    "Alright, all tests pass. Ship it.",
    "Wait, one more sanity check — did I update the changelog?",
    "Deploying. Fingers crossed.",
  ],
  "support-agent": [
    // TOOL_CONTEXT
    "Customer 4582's refund is stuck. Pull the CRM tool schema and the billing adjustment API docs.",
    "The escalation workflow requires manager approval. Find the route for the approval queue in the admin tool.",
    "Run the SLA compliance report for enterprise accounts — the CFO wants to see our response time metrics.",
    "The warehouse shows this account as active but billing shows cancelled. Which tool is the source of truth?",
    "I need the premium support playbook for billing disputes. Pull it from the internal wiki API.",
    // EDGEKV_MEMORY
    "Load the full customer history — every interaction, every ticket, every invoice for the past 3 years.",
    "The prior support agent left internal notes on this account. Pull the session transcript from last week.",
    "Check the customer's account tier and SLA level. If they're premium, the refund policy is more lenient.",
    "Recall similar refund cases from memory — what worked last time for enterprise accounts with billing errors?",
    "This customer has complained about the same bug four times. Pull the incident history to build a timeline.",
    // VECTOR_WEIGHTS
    "Search the knowledge base for resolution patterns — retrieve the top 5 semantically similar ticket closures.",
    "Embed this customer's complaint into the sentiment analysis index. Does it rank as high urgency?",
    "Cluster all refund requests from this month. Are they similar in root cause, or is it noise?",
    "Retrieve the nearest matching policy documents from the vector index for the specific refund clause cited.",
    "Rank the customer health scores across the enterprise tier. Who else is at risk of churning?",
    "Search the sentiment index for accounts with declining NPS scores — cross-reference with refund requests.",
    // NO_OP / short
    "Summarize the resolution and close the ticket.",
    "Manager signed off. Process the refund and notify the customer.",
    "Double-check the CRM sync before closing. Don't want a duplicate ticket.",
    "Crisis averted. Take a breath.",
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
    /schema|sql|tool|api|function|warehouse|test|runner|route|pipeline|middleware|config|deploy|migration|package|build|compile/.test(
      normalized,
    )
  )
    return "TOOL_CONTEXT";
  if (
    /memory|customer|account|session|history|prior|refund|policy|recall|tier|incident|timeline|review|standards/.test(
      normalized,
    )
  )
    return "EDGEKV_MEMORY";
  if (
    /vector|search|embed|retrieve|similar|rank|cluster|index|knowledge|semantic|nearest|sentiment/.test(
      normalized,
    )
  )
    return "VECTOR_WEIGHTS";
  return normalized.trim().length < 10 ? "NO_OP" : "VECTOR_WEIGHTS";
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
