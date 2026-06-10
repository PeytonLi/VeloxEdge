#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════
// VeloxEdge Live Demo Script
//
// Drives the full chat → embed → predict → resolve pipeline
// against the local Next.js dev server (default http://localhost:3000).
//
// Usage:
//   node scripts/demo.mjs                    # deterministic mode
//   node scripts/demo.mjs --chat --embed     # full agentic pipeline
//   node scripts/demo.mjs --steps 10         # run 10 bandit steps
// ═══════════════════════════════════════════════════════════════

const BASE = process.env.VELOX_DEMO_URL ?? "http://localhost:3000";
const DIMENSIONS = 12;
const ALPHA = 1.0;
const ACTIONS = ["TOOL_CONTEXT", "EDGEKV_MEMORY", "VECTOR_WEIGHTS", "NO_OP"];
const SESSION_ID = "demo-" + Date.now();

const args = process.argv.slice(2);
const USE_CHAT = args.includes("--chat");
const USE_EMBED = args.includes("--embed");
const STEPS = Math.max(
  1,
  parseInt(args.find((a, i) => args[i - 1] === "--steps") ?? "5", 10),
);

const PROMPTS = [
  "Analyze Q4 churn patterns in the revenue data and suggest retention strategies",
  "Load the database schema for the warehouse metrics tables",
  "Find similar customer cohorts that showed early churn signals last quarter",
  "Cross-reference the anomaly scores with fiscal calendar events",
  "Generate a summary report with the top 3 churn drivers and recommended actions",
];

// ── helpers ────────────────────────────────────────────────────

const C = { reset: "\x1b[0m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", dim: "\x1b[2m", bold: "\x1b[1m" };

function log(section, ...parts) {
  const header = section === "CHAT" ? C.green : section === "EMBED" ? C.cyan : section === "PREDICT" ? C.yellow : section === "RESOLVE" ? C.yellow : section === "STATS" ? C.bold : C.dim;
  console.log(`\n${header}── ${section} ──${C.reset}`);
  for (const p of parts) console.log(p);
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function truncate(s, max = 200) {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

function actionIcon(action) {
  return action === "TOOL_CONTEXT" ? "🔧" : action === "EDGEKV_MEMORY" ? "🧠" : action === "VECTOR_WEIGHTS" ? "🔍" : "⏸️";
}

// ── main ────────────────────────────────────────────────────────

console.log(`${C.bold}${C.cyan}
╔═══════════════════════════════════════════════════════════╗
║              ⚡ VeloxEdge Live Demo                       ║
║         Predictive Latent Bandit Caching                  ║
╚═══════════════════════════════════════════════════════════╝
${C.reset}`);
console.log(`${C.dim}Server : ${BASE}`);
console.log(`Mode   : ${USE_CHAT ? "Chat → " : ""}${USE_EMBED ? "Real Embed" : "Deterministic"} → Bandit`);
console.log(`Steps  : ${STEPS}`);
console.log(`Session: ${SESSION_ID}${C.reset}`);

const stats = { steps: 0, hits: 0, misses: 0, totalReward: 0, totalLatency: 0 };
let step = 0;

for (let i = 0; i < STEPS; i++) {
  step++;
  const prompt = PROMPTS[i % PROMPTS.length];

  // ── Step 1: Chat (if enabled) ──────────────────────────────
  let label = prompt;
  if (USE_CHAT) {
    log("CHAT", `Prompt → "${C.bold}${truncate(prompt, 100)}${C.reset}"`);
    const chatRes = await post("/api/chat", { prompt, provider: "deepseek" });
    if (chatRes.body.response) {
      label = chatRes.body.response;
      log("CHAT", `${C.green}Agent response:${C.reset}`, `  ${truncate(label, 280)}`);
    } else {
      log("CHAT", `${C.red}Chat failed:${C.reset} ${chatRes.body.error ?? chatRes.status}`, `${C.dim}Falling back to raw prompt${C.reset}`);
    }
  }

  // ── Step 2: Embed ──────────────────────────────────────────
  const embedProvider = USE_EMBED ? "gemini" : "deterministic";
  const embedRes = await post("/api/embed", { input: label, dimensions: DIMENSIONS, provider: embedProvider });
  const contextVector = embedRes.body.vector;
  if (!contextVector) {
    log("EMBED", `${C.red}Embed failed:${C.reset} ${embedRes.body.error ?? embedRes.status}`);
    continue;
  }
  log("EMBED", `"${C.dim}${truncate(label, 100)}${C.reset}" → [${contextVector.slice(0, 4).map(v => v.toFixed(3)).join(", ")}…] (${embedRes.body.provider ?? "?"})`);

  // ── Step 3: Predict ────────────────────────────────────────
  const config = { dimensions: DIMENSIONS, alpha: ALPHA, actions: ACTIONS };
  const predictRes = await post("/api/edge/predict", {
    sessionId: SESSION_ID,
    step,
    ...config,
    contextVector,
  });

  if (predictRes.body.error) {
    log("PREDICT", `${C.red}Error:${C.reset} ${predictRes.body.error}`);
    continue;
  }

  const action = predictRes.body.action;
  const key = predictRes.body.predictedKey;
  const prefetchMs = predictRes.body.prefetch?.originMs ?? "?";
  const cacheWritten = predictRes.body.prefetch?.cacheWritten ?? false;

  log("PREDICT",
    `Action  : ${actionIcon(action)} ${C.bold}${action}${C.reset}`,
    `Key     : ${C.dim}${truncate(key, 90)}${C.reset}`,
    `Prefetch: ${cacheWritten ? C.green + "✓ cached" + C.reset : C.red + "✗ failed" + C.reset} in ${prefetchMs}ms`,
    `UCB     : ${predictRes.body.ucbBreakdown?.map(a => `${a.action.slice(0,2)} ${a.ucbValue.toFixed(3)}`).join(" | ") ?? "?"}`,
    `Compute : ${predictRes.body.computeMicros ?? "?"}µs`,
  );

  // ── Step 4: Resolve ────────────────────────────────────────
  const resolveRes = await post("/api/edge/resolve", {
    sessionId: SESSION_ID,
    step,
    requestedKey: key,
    config,
    contextVector,
  });

  if (resolveRes.body.error) {
    log("RESOLVE", `${C.red}Error:${C.reset} ${resolveRes.body.error}`);
    continue;
  }

  const cacheHit = resolveRes.body.cacheHit;
  const latencyMs = resolveRes.body.latencyMs;
  const reward = resolveRes.body.reward;

  stats.steps++;
  if (cacheHit) stats.hits++; else stats.misses++;
  stats.totalReward += reward;
  stats.totalLatency += latencyMs;

  const hitIcon = cacheHit ? `${C.green}HIT${C.reset}` : `${C.red}MISS${C.reset}`;
  log("RESOLVE",
    `Cache   : ${hitIcon}`,
    `Latency : ${latencyMs}ms`,
    `Reward  : ${C.yellow}${reward.toFixed(3)}${C.reset}`,
  );
}

// ── final stats ────────────────────────────────────────────────

const avgReward = stats.steps > 0 ? stats.totalReward / stats.steps : 0;
const hitRate = stats.steps > 0 ? (stats.hits / stats.steps * 100) : 0;
const avgLatency = stats.steps > 0 ? stats.totalLatency / stats.steps : 0;

log("STATS",
  `${C.bold}Session complete — ${stats.steps} steps${C.reset}`,
  `Hits    : ${C.green}${stats.hits}${C.reset}  Misses: ${C.red}${stats.misses}${C.reset}  Hit rate: ${hitRate.toFixed(0)}%`,
  `Avg reward: ${C.yellow}${avgReward.toFixed(3)}${C.reset}  Avg latency: ${avgLatency.toFixed(1)}ms`,
  avgReward > 0.6
    ? `${C.green}✓ Bandit converged — cache is saving real latency${C.reset}`
    : `${C.yellow}○ Run more steps to see convergence${C.reset}`,
);

console.log(`\n${C.dim}Open http://localhost:3000 to see the dashboard${C.reset}\n`);
