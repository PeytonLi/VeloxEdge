# ⚡ VeloxEdge

**Predictive Latent Bandit Caching for Agentic AI Workflows**

VeloxEdge converts edge infrastructure from a reactive storage bucket into an active, predictive cache engine. Using a closed-form Contextual Multi-Armed Bandit (LinUCB) algorithm, it watches an AI agent's latent-space trajectory and speculatively pre-fetches context blocks, tool schemas, and memory assets *before* the agent requests them — driving Time-To-First-Token overhead toward zero.

> Built for **Inference Hack Day · San Francisco · June 2026**

---

## The Problem: Agentic Latent Stalls

Modern AI applications are increasingly multi-agent: an autonomous agent executes continuous cycles of text generation → vector retrieval → tool execution → memory update → recursive reasoning. Each cycle is tightly coupled, so any latency in one step stalls the entire pipeline.

Traditional caching completely fails here. String-matching caches and TTL strategies assume prompt stability. In an agentic loop, every prompt is dynamically mutated — timestamps, JSON arguments, conversational drift — producing a **near 100% cache miss rate** and multi-second cold-fetch round-trips to origin on every cycle.

```
Standard Agent Loop:
  Generate → [800ms cold fetch] → Tool Call → [800ms cold fetch] → Reason → repeat
              ^^^^^^^^^^^^^^^^               ^^^^^^^^^^^^^^^^
              These stalls compound across hundreds of steps
```

## The Solution: Predict, Don't React

VeloxEdge operates entirely in **latent space** (semantic embedding vectors). Rather than caching on prompt strings, it tracks the *direction* an agent's thought is moving and pre-warms the assets it will need next — before the request arrives.

```
[Agent State Vector xₜ]
         │
         ▼
┌────────────────────────────┐
│   LinUCB Edge Bandit       │  ← closed-form matrix math, no backprop
└─────────────┬──────────────┘
              │
    Predicts optimal pre-fetch action
              │
    ┌─────────┼──────────┬─────────────────┐
    ▼         ▼          ▼                 ▼
  NO_OP   Tool       EdgeKV           Vector
          Context    Memory Chunk     Weights
          Pre-fetch  Pre-warm         Pre-load
```

The result: assets are already in local RAM/EdgeKV when the agent requests them. Cold-fetch RTT (~800ms) collapses to an edge cache hit (~5ms).

---

## How It Works: LinUCB

VeloxEdge frames speculative cache pre-fetching as a **Contextual Multi-Armed Bandit** problem. At every agent step, the algorithm selects the pre-fetch action maximising the Upper Confidence Bound:

```
a* = argmax_a [ xᵀθ̂_a  +  α · √(xᵀA_a⁻¹x) ]
               └──────┘     └───────────────┘
            exploitation      exploration bonus
           (known reward)    (uncertainty penalty)
```

Where:
- `xₜ ∈ ℝᵈ` — the agent's current context embedding vector
- `θ̂_a = A_a⁻¹ b_a` — the current weight estimate for arm `a`
- `A_a = DᵀD + I` — the regularised covariance matrix (ridge regression)
- `α` — exploration hyperparameter controlling uncertainty width

When the reward signal `rₜ ∈ [0,1]` (normalised latency reduction) arrives, state updates are **closed-form** — no gradient descent, no backpropagation:

```
A_a ← A_a + x xᵀ
b_a ← b_a + r · x
θ̂_a = A_a⁻¹ b_a
```

This is fast enough to run natively on edge serverless infrastructure (≤1.8ms at d=12).

---

## Architecture

```
veloxedge/
├── apps/
│   ├── edgeworker/                  # Akamai EdgeWorkers bundle (deployable)
│   │   ├── src/main.js              # predict / resolve / update handlers
│   │   ├── edgekv.js                # Vendored EdgeKV client helper
│   │   └── DEPLOY.md                # Activation runbook (self-contained alt below)
│   └── web/                         # Next.js 15 App Router dashboard
│       ├── app/
│       │   ├── page.tsx             # 3-zone live canvas (A / B / C)
│       │   └── api/
│       │       ├── edge/predict/    # Bandit prediction + prefetch endpoint
│       │       ├── edge/resolve/    # Measured cache hit/miss + reward endpoint
│       │       └── origin/[asset]/  # Mock origin serving real asset payloads
│       ├── lib/
│       │   ├── edge/                # Emulator, asset catalog, edge client, embeddings
│       │   └── simulation/          # Scripted journeys, naive cache baseline
│       └── hooks/useVeloxEngine.ts  # React hook owning the engine + real value loop
└── packages/
    └── bandit-engine/               # Pure TypeScript LinUCB core (no React, no I/O)
        ├── src/index.ts             # LinUCBEngine class (Sherman-Morrison inverse)
        ├── src/linalg.ts            # Matrix operations (invert, matVec, dot, variance)
        ├── src/liveLoop.ts          # deriveAssetKey + rewardFromLatency (pure)
        ├── src/edge.ts              # Frozen wire contract (DTOs, TTL constants)
        └── src/types.ts             # BanditConfig, EngineSnapshot, UcbBreakdown
```

### The 3-Zone Dashboard

```
┌────────────────────────────────────────────────────────────────┐
│                      VELOXEDGE LIVE DASHBOARD                  │
├──────────────────────────────┬─────────────────────────────────┤
│  A · LATENCY ANALYTICS       │  C · ACTIVE SIMULATION          │
│  • Naive vs. VeloxEdge RTT   │  • Interactive agent console    │
│  • Cache hit/cold counters   │  • Journey selector             │
│  • Time-Saved dividend (ms)  │  • Speculative action stream    │
├──────────────────────────────│  • Microsecond execution steps  │
│  B · MATH CO-PROCESSOR       │                                 │
│  • Covariance variance grid  │                                 │
│  • θ̂ convergence chart       │                                 │
│  • α What-If slider          │                                 │
└──────────────────────────────┴─────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Package manager | pnpm v10 (workspace protocol) |
| Build system | Turborepo 2.x (parallel pipeline, task graph) |
| Frontend | Next.js 15 (App Router, React 19) |
| Styling | Tailwind CSS v4 |
| Charts | Recharts (line charts) + hand-rolled CSS-grid heatmap |
| Bandit engine | Pure TypeScript, zero runtime dependencies |
| Testing | Jest + ts-jest (unit tests on the engine) |
| Edge runtime | Self-contained Next.js API routes (local emulator with real measured loop) |
| Edge target (optional) | Akamai EdgeWorkers + EdgeKV (deployable bundle, requires EdgeWorkers access) |

---

## Getting Started

**Prerequisites:** Node.js 18+, pnpm 10+

```bash
# Install dependencies
pnpm install

# Build all packages
turbo run build

# Run the dashboard locally
pnpm --filter web dev
# → http://localhost:3000

# Run engine tests
pnpm --filter @veloxedge/bandit-engine test
```

---

## Performance

The LinUCB engine is benchmarked as part of the test suite:

| Metric | Target | Approach |
|---|---|---|
| Predict latency (d=12) | ≤ 1.8ms | Naïve Gauss-Jordan; O(d³) is trivial at d=12 |
| Latency improvement vs naive cache | ≥ 45% | Measured cold-fetch (~120ms) vs edge cache hit (~5ms) over 50 steps |
| Matrix stability | Zero NaN/overflow | Identity regularisation (`A = DᵀD + I`) guarantees non-singularity |

---

## Bandit Engine API

```typescript
import { LinUCBEngine } from '@veloxedge/bandit-engine';

const engine = new LinUCBEngine({
  dimensions: 12,   // context embedding dimension
  alpha: 1.0,       // exploration parameter
  actions: [
    'PREFETCH_TOOL_CONTEXT',
    'PREWARM_EDGEKV_MEMORY',
    'PRELOAD_VECTOR_WEIGHTS',
    'NO_OP',
  ],
});

// Predict next pre-fetch action from agent's current state vector
const { action, ucbBreakdown } = engine.predictNextAction(contextVector);

// Close-form update after reward observed
engine.updateWeights(action, contextVector, reward); // reward ∈ [0, 1]

// Snapshot internal state for dashboard visualisation
const { aInvDiag, thetaHat, lastUcb } = engine.snapshot();

// Re-parameterise α live (preserves accumulated state)
const tuned = engine.withAlpha(0.5);
```

---

## Design Decisions

**Why a bandit, not a neural net?**
Edge serverless functions have strict CPU/memory budgets and millisecond cold-start windows. A neural net requires backpropagation, GPU inference, and model loading — all incompatible with real-time edge execution. LinUCB is a single closed-form matrix multiply: fast, deterministic, and interpretable.

**Why synthetic context vectors?**
Running a real embedding API (OpenAI, etc.) at every agent step adds a network dependency and ironic latency to a latency demo. VeloxEdge uses deterministic cluster-based vectors from scripted journeys, with keyword-to-vector hashing for live input. The bandit math is identical regardless of how vectors are produced.

**Why include a NO_OP arm?**
A cache that always pre-fetches something isn't smarter than the status quo — it just burns bandwidth. The NO_OP arm lets the bandit learn *when* pre-fetching is genuinely worthwhile, which is a stronger correctness story for judges and a more honest production design.

**Why Gauss-Jordan over Sherman-Morrison?**
Sherman-Morrison gives O(d²) incremental inverse updates vs O(d³) full recomputation. At d=12, both are sub-millisecond — so the simpler, obviously-correct Gauss-Jordan implementation is preferable under hackathon time constraints. Sherman-Morrison is a clean upgrade path for larger d.

---

## Roadmap

- [x] Real Akamai EdgeWorker + EdgeKV deployment (code complete; requires EdgeWorkers access to activate)
- [x] Live embedding integration (pluggable adapter; deterministic default)
- [x] Sherman-Morrison incremental inverse for O(d²) updates at larger d
- [x] Multi-agent session isolation (per-session bandit state via sessionId scoping)
- [x] Self-contained Next.js deployment (no EdgeWorker dependency required for full value loop)
- [ ] Real embedding provider (OpenAI / Cohere via VELOX_EMBEDDING_* env)
- [ ] Reward shaping beyond binary hit/miss (partial cache relevance scoring)
- [ ] Geographic edge distribution (multi-region deploy)
