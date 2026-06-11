"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LinUCBEngine,
  deriveAssetKey,
  rewardFromLatency,
} from "@veloxedge/bandit-engine";
import type {
  EdgePredictResponse,
  EdgeResolveResponse,
  EngineSnapshot,
  PredictionResult,
} from "@veloxedge/bandit-engine";
import { edgeClient, type EdgeClientResponse } from "@/lib/edge/edgeClient";
import { createEmbeddingAdapter } from "@/lib/edge/embeddingAdapter";
import { descriptorForAsset } from "@/lib/edge/assetCatalog";
import {
  COLD_FETCH_MS,
  NaiveStringCache,
  accumulateStats,
  embed,
  emptyStats,
  journeys,
} from "@/lib/simulation";
import type {
  JourneyStep,
  LatencyResult,
  LatencyStats,
} from "@/lib/simulation";

export type VeloxEngineMode = "local" | "edge";
export type EdgeStatus = "idle" | "ok" | "fallback" | "error";

export interface InterceptorEvent {
  timestamp: number;
  message: string;
  action: string;
  cacheHit: boolean;
}
export interface TelemetryPoint {
  step: number;
  naive: number;
  velox: number;
  saved: number;
  cacheHits: number;
}
export interface SnapshotTelemetryPoint {
  step: number;
  snapshot: EngineSnapshot;
}

export interface VeloxEngineState {
  snapshot: EngineSnapshot | null;
  snapshotHistory: SnapshotTelemetryPoint[];
  stats: LatencyStats;
  timeline: TelemetryPoint[];
  events: InterceptorEvent[];
  alpha: number;
  ready: boolean;
  activeStepLabel: string;
  lastAction: string;
  mode: VeloxEngineMode;
  edgeRttMs: number | null;
  edgeComputeMicros: number | null;
  edgeStatus: EdgeStatus;
  edgeError: string | null;
}

export interface VeloxEngineActions {
  step: (input: string | number[]) => Promise<void>;
  setAlpha: (newAlpha: number) => void;
  setMode: (mode: VeloxEngineMode) => void;
  reset: () => void;
  runJourney: (journeyId: string, delayMs?: number) => Promise<void>;
}

const DEFAULT_DIMENSIONS = 12;
const DEFAULT_ALPHA = 1;
const MAX_EVENTS = 80;
const MAX_HISTORY = 64;
const EDGE_HIT_MS = 5;
const LOCAL_ASSET_TTL_MS = 60_000;
const ACTIONS = ["TOOL_CONTEXT", "EDGEKV_MEMORY", "VECTOR_WEIGHTS", "NO_OP"];
const DEFAULT_ACTION = ACTIONS[0];
const INITIAL_STEP_LABEL = "Awaiting first latent trajectory";

interface Scenario {
  contextVector: number[];
  label: string;
  naiveKey: string;
}
interface StepOutcome {
  prediction: PredictionResult;
  latency: LatencyResult;
  snapshot: EngineSnapshot | null;
  rttMs: number | null;
  computeMicros: number | null;
  source: VeloxEngineMode;
  requestedKey: string;
}
interface LocalCachedAsset {
  coldOriginMs: number;
  expiresAt: number;
}

function createInitialTelemetryPoint(): TelemetryPoint {
  return { step: 0, naive: 0, velox: 0, saved: 0, cacheHits: 0 };
}
function clamp(value: number, min: number, max: number): number {
  return Number.isNaN(value) ? min : Math.max(min, Math.min(max, value));
}
function clockNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
function elapsedMs(sessionStart: number): number {
  return Math.max(0, Math.round(clockNow() - sessionStart));
}
function formatTimestamp(timestamp: number): string {
  return String(Math.max(0, Math.round(timestamp))).padStart(3, "0");
}
function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}
function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) =>
    window.setTimeout(resolve, Math.max(0, delayMs)),
  );
}
function makeSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "velox-" + Math.random().toString(36).slice(2);
}

function resizeVector(values: number[], dimensions: number): number[] {
  const vector = values
    .slice(0, dimensions)
    .map((value) => (Number.isFinite(value) ? value : 0));
  while (vector.length < dimensions) vector.push(0);
  return vector;
}
function dot(left: number[], right: number[]): number {
  let total = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1)
    total += left[index] * right[index];
  return total;
}
function magnitude(values: number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
}
function cosineSimilarity(left: number[], right: number[]): number {
  return dot(left, right) / (magnitude(left) * magnitude(right));
}
function allJourneySteps(): JourneyStep[] {
  return journeys.flatMap((journey) => journey.steps);
}

function nearestJourneyStep(
  contextVector: number[],
  dimensions: number,
): JourneyStep {
  const steps = allJourneySteps();
  let bestStep = steps[0];
  let bestScore = -Infinity;
  const resizedContext = resizeVector(contextVector, dimensions);
  for (const step of steps) {
    const score = cosineSimilarity(
      resizedContext,
      resizeVector(step.contextVector, dimensions),
    );
    if (score > bestScore) {
      bestScore = score;
      bestStep = step;
    }
  }
  return (
    bestStep ?? {
      label: "Fallback local reasoning step",
      contextVector: resizedContext,
      bestAction: "NO_OP",
      coldFetchMs: COLD_FETCH_MS,
    }
  );
}

function resolveChatProvider(): string | null {
  if (typeof window === "undefined") return null;
  const configured = (process.env.NEXT_PUBLIC_VELOX_CHAT_PROVIDER ?? "")
    .trim()
    .toLowerCase();
  if (configured === "deepseek" || configured === "openai") return configured;
  return null;
}

async function chatWithAgent(
  prompt: string,
  provider: string,
): Promise<string> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, provider }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ??
        `Chat API returned ${response.status}`,
    );
  }

  const json = (await response.json()) as { response: string };
  return json.response;
}

async function resolveScenario(
  input: string | number[],
  dimensions: number,
  turn: number,
): Promise<Scenario> {
  if (Array.isArray(input)) {
    const contextVector = resizeVector(input, dimensions);
    const step = nearestJourneyStep(contextVector, dimensions);
    return {
      contextVector,
      label: step.label,
      naiveKey: step.label + " :: latent-turn=" + String(turn),
    };
  }

  const trimmed = input.trim();
  const chatProvider = resolveChatProvider();
  let label: string;

  if (chatProvider) {
    // Full agentic pipeline: prompt → LLM chat → embed response → bandit
    try {
      label = await chatWithAgent(trimmed, chatProvider);
    } catch {
      // Chat failed — fall through to direct embedding of the raw prompt
      label = trimmed.length > 0 ? trimmed : "Untitled live prompt";
    }
  } else {
    label = trimmed.length > 0 ? trimmed : "Untitled live prompt";
  }

  const adapter = createEmbeddingAdapter();
  let contextVector: number[];
  try {
    contextVector = await adapter.embed(label, dimensions);
  } catch {
    contextVector = embed(label, journeys, dimensions);
  }
  return {
    contextVector: resizeVector(contextVector, dimensions),
    label,
    naiveKey:
      label.toLowerCase().slice(0, 120) + " :: json_args_nonce=" + String(turn),
  };
}

function createEngine(dimensions: number, alpha: number): LinUCBEngine {
  return new LinUCBEngine({ dimensions, alpha, actions: ACTIONS });
}
function safeSnapshot(engine: LinUCBEngine): EngineSnapshot | null {
  try {
    return engine.snapshot();
  } catch {
    return null;
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case "TOOL_CONTEXT":
      return "Pre-fetch tool context";
    case "EDGEKV_MEMORY":
      return "Pre-fetch EdgeKV memory";
    case "VECTOR_WEIGHTS":
      return "Pre-fetch vector weights";
    case "NO_OP":
      return "Hold cache line (NO_OP)";
    default:
      return action;
  }
}

function winningScore(prediction: PredictionResult): string {
  const winner = prediction.ucbBreakdown.find(
    (entry) => entry.action === prediction.action,
  );
  return winner === undefined ? "n/a" : winner.ucbValue.toFixed(3);
}
function predictionFromEdge(response: EdgePredictResponse): PredictionResult {
  return { action: response.action, ucbBreakdown: response.ucbBreakdown };
}
function predictionFromResolve(
  response: EdgeResolveResponse,
  selectedAction: string,
): PredictionResult {
  return { action: selectedAction, ucbBreakdown: response.ucbBreakdown };
}

function latencyFromMeasured(
  cacheHit: boolean,
  latencyMs: number,
  reward: number,
  coldOriginMs: number,
): LatencyResult {
  return {
    cacheHit,
    latencyMs: roundMs(latencyMs),
    savedMs: cacheHit ? roundMs(Math.max(0, coldOriginMs - latencyMs)) : 0,
    reward,
  };
}

async function measuredLocalResolve(
  key: string,
  cache: Map<string, LocalCachedAsset>,
): Promise<{
  cacheHit: boolean;
  latencyMs: number;
  coldOriginMs: number;
  reward: number;
}> {
  const cached = cache.get(key);
  const startedAt = clockNow();
  if (cached && cached.expiresAt > Date.now()) {
    await delay(EDGE_HIT_MS);
    const latencyMs = roundMs(clockNow() - startedAt);
    return {
      cacheHit: true,
      latencyMs,
      coldOriginMs: cached.coldOriginMs,
      reward: rewardFromLatency(latencyMs, EDGE_HIT_MS, cached.coldOriginMs),
    };
  }
  cache.delete(key);
  const descriptor = descriptorForAsset(key);
  await delay(descriptor.coldOriginMs);
  const latencyMs = roundMs(clockNow() - startedAt);
  cache.set(key, {
    coldOriginMs: descriptor.coldOriginMs,
    expiresAt: Date.now() + LOCAL_ASSET_TTL_MS,
  });
  return {
    cacheHit: false,
    latencyMs,
    coldOriginMs: descriptor.coldOriginMs,
    reward: rewardFromLatency(latencyMs, EDGE_HIT_MS, descriptor.coldOriginMs),
  };
}

function buildEvents(
  baseTimestamp: number,
  scenario: Scenario,
  prediction: PredictionResult,
  result: LatencyResult,
  naiveAction: string | null,
  mode: VeloxEngineMode,
  rttMs: number | null,
  computeMicros: number | null,
  requestedKey: string,
): InterceptorEvent[] {
  const action = prediction.action;
  const baseline =
    naiveAction === null
      ? "Naive cache MISS"
      : "Naive cache HIT for " + actionLabel(naiveAction);
  const runtime =
    mode === "edge"
      ? "LIVE EDGE rtt=" +
        (rttMs?.toFixed(1) ?? "n/a") +
        "ms compute=" +
        (computeMicros ?? 0) +
        "µs"
      : "LOCAL measured cache";
  const outcome = result.cacheHit
    ? "Measured cache HIT for " +
      requestedKey +
      " in " +
      result.latencyMs +
      "ms"
    : "Measured cache MISS for " +
      requestedKey +
      " in " +
      result.latencyMs +
      "ms";
  const event = (offset: number, message: string): InterceptorEvent => {
    const timestamp = baseTimestamp + offset;
    return {
      timestamp,
      message: "[" + formatTimestamp(timestamp) + "ms] " + message,
      action,
      cacheHit: result.cacheHit,
    };
  };
  const baseEvents: InterceptorEvent[] = [];

  baseEvents.push(event(0, "Logit Stream Arrived → token buffer locked"));
  baseEvents.push(event(2, "Naive Cache Probe → " + baseline));
  baseEvents.push(
    event(5, "State Vector Extracted → " + scenario.label + " (d=12)"),
  );
  baseEvents.push(event(8, "Covariance Matrix A⁻¹ Loaded → ridge-regularised"));
  baseEvents.push(event(11, "LinUCB Argmax — computing per-arm UCB:"));

  // One event per arm for the UCB breakdown
  for (let i = 0; i < prediction.ucbBreakdown.length; i++) {
    const b = prediction.ucbBreakdown[i];
    const marker = b.action === action ? "▶" : " ";
    baseEvents.push(
      event(
        12 + i,
        marker +
          " " +
          b.action.padEnd(22) +
          "θ̂ᵀx=" +
          b.expectedReward.toFixed(4) +
          "  ασ=" +
          b.explorationBonus.toFixed(4) +
          "  UCB=" +
          b.ucbValue.toFixed(4),
      ),
    );
  }

  const armCount = prediction.ucbBreakdown.length;
  baseEvents.push(
    event(
      13 + armCount,
      "▶ Selected: " +
        actionLabel(action) +
        "  (UCB=" +
        winningScore(prediction) +
        ")",
    ),
  );
  baseEvents.push(
    event(15 + armCount, runtime + " → speculative pre-fetch dispatched"),
  );
  baseEvents.push(
    event(18 + armCount, "Agent Request Intercepted → " + requestedKey),
  );
  baseEvents.push(event(21 + armCount, outcome));
  baseEvents.push(
    event(
      24 + armCount,
      "Reward Signal → r=" + result.reward.toFixed(3) + "  (∈ [0,1])",
    ),
  );
  baseEvents.push(
    event(26 + armCount, "Ridge Update → Aₐ ← Aₐ + xxᵀ  |  bₐ ← bₐ + r·x"),
  );
  baseEvents.push(
    event(28 + armCount, "θ̂ₐ Re-estimated → next prediction ready"),
  );

  return baseEvents;
}

export function useVeloxEngine(
  _dimensions?: number,
  _alpha?: number,
): VeloxEngineState & VeloxEngineActions {
  const dimensions = Math.max(1, Math.floor(_dimensions ?? DEFAULT_DIMENSIONS));
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [snapshotHistory, setSnapshotHistory] = useState<
    SnapshotTelemetryPoint[]
  >([]);
  const [stats, setStats] = useState<LatencyStats>(() => emptyStats());
  const [timeline, setTimeline] = useState<TelemetryPoint[]>(() => [
    createInitialTelemetryPoint(),
  ]);
  const [events, setEvents] = useState<InterceptorEvent[]>([]);
  const [alpha, setAlphaState] = useState(() =>
    clamp(_alpha ?? DEFAULT_ALPHA, 0.05, 4),
  );
  const [ready, setReady] = useState(false);
  const [activeStepLabel, setActiveStepLabel] = useState(INITIAL_STEP_LABEL);
  const [lastAction, setLastAction] = useState(DEFAULT_ACTION);
  const [mode, setModeState] = useState<VeloxEngineMode>("local");
  const [edgeRttMs, setEdgeRttMs] = useState<number | null>(null);
  const [edgeComputeMicros, setEdgeComputeMicros] = useState<number | null>(
    null,
  );
  const [edgeStatus, setEdgeStatus] = useState<EdgeStatus>("idle");
  const [edgeError, setEdgeError] = useState<string | null>(null);

  const alphaRef = useRef(alpha);
  const engineRef = useRef<LinUCBEngine | null>(null);
  const edgeMirrorRef = useRef<LinUCBEngine | null>(null);
  const naiveCacheRef = useRef(new NaiveStringCache());
  const localAssetCacheRef = useRef(new Map<string, LocalCachedAsset>());
  const statsRef = useRef<LatencyStats>(emptyStats());
  const lastContextRef = useRef<number[] | null>(null);
  const sessionStartRef = useRef(clockNow());
  const turnRef = useRef(0);
  const modeRef = useRef<VeloxEngineMode>("local");
  const sessionIdRef = useRef(makeSessionId());

  const resetLocalState = useCallback(() => {
    const engine = createEngine(dimensions, alphaRef.current);
    const initialSnapshot = safeSnapshot(engine);
    const initialStats = emptyStats();
    engineRef.current = engine;
    edgeMirrorRef.current = null;
    naiveCacheRef.current.clear();
    localAssetCacheRef.current.clear();
    statsRef.current = initialStats;
    lastContextRef.current = null;
    sessionStartRef.current = clockNow();
    sessionIdRef.current = makeSessionId();
    turnRef.current = 0;
    setSnapshot(initialSnapshot);
    setSnapshotHistory(
      initialSnapshot ? [{ step: 0, snapshot: initialSnapshot }] : [],
    );
    setStats(initialStats);
    setTimeline([createInitialTelemetryPoint()]);
    setEvents([]);
    setActiveStepLabel(INITIAL_STEP_LABEL);
    setLastAction(DEFAULT_ACTION);
    setEdgeRttMs(null);
    setEdgeComputeMicros(null);
    setEdgeStatus("idle");
    setEdgeError(null);
    setReady(true);
  }, [dimensions]);

  useEffect(() => {
    resetLocalState();
    return () => {
      engineRef.current = null;
    };
  }, [dimensions, resetLocalState]);

  const runLocalStep = useCallback(
    async (scenario: Scenario): Promise<StepOutcome> => {
      let engine = engineRef.current;
      if (engine === null) {
        engine = createEngine(dimensions, alphaRef.current);
        engineRef.current = engine;
        setReady(true);
      }
      const prediction = engine.predictNextAction(scenario.contextVector);
      // Cache by predicted action so the bandit converges: after learning
      // which arms produce high reward, repeat predictions of the same
      // action hit the warmed local cache regardless of context drift.
      const cacheKey = "velox:action:" + prediction.action;
      const derivedKey = deriveAssetKey(
        scenario.contextVector,
        prediction.action,
      );
      const measured = await measuredLocalResolve(
        cacheKey,
        localAssetCacheRef.current,
      );
      const latency = latencyFromMeasured(
        measured.cacheHit,
        measured.latencyMs,
        measured.reward,
        measured.coldOriginMs,
      );
      engine.updateWeights(
        prediction.action,
        scenario.contextVector,
        latency.reward,
      );
      return {
        prediction,
        latency,
        snapshot: safeSnapshot(engine),
        rttMs: null,
        computeMicros: null,
        source: "local",
        requestedKey: derivedKey,
      };
    },
    [dimensions],
  );

  const runEdgeStep = useCallback(
    async (scenario: Scenario, stepNumber: number): Promise<StepOutcome> => {
      const requestConfig = {
        sessionId: sessionIdRef.current,
        dimensions,
        alpha: alphaRef.current,
        actions: ACTIONS,
      };
      const predictResponse: EdgeClientResponse<EdgePredictResponse> =
        await edgeClient.predict({
          ...requestConfig,
          contextVector: scenario.contextVector,
          step: stepNumber,
        });
      const prediction = predictionFromEdge(predictResponse);
      const resolveResponse: EdgeClientResponse<EdgeResolveResponse> =
        await edgeClient.resolve({
          sessionId: sessionIdRef.current,
          config: requestConfig,
          requestedKey: predictResponse.predictedKey,
          contextVector: scenario.contextVector,
          step: stepNumber,
        });
      const latency = latencyFromMeasured(
        resolveResponse.cacheHit,
        resolveResponse.latencyMs,
        resolveResponse.reward,
        descriptorForAsset(resolveResponse.requestedKey).coldOriginMs,
      );
      const resolvedPrediction = predictionFromResolve(
        resolveResponse,
        prediction.action,
      );

      // Maintain a local mirror of the edge engine state so the
      // convergence chart has snapshot data for the LIVE EDGE path.
      let mirror = edgeMirrorRef.current;
      if (mirror === null || mirror.getAlpha() !== alphaRef.current) {
        mirror = createEngine(dimensions, alphaRef.current);
        edgeMirrorRef.current = mirror;
      }
      mirror.updateWeights(
        resolvedPrediction.action,
        scenario.contextVector,
        latency.reward,
      );

      return {
        prediction:
          resolvedPrediction.ucbBreakdown.length > 0
            ? resolvedPrediction
            : prediction,
        latency,
        snapshot: safeSnapshot(mirror),
        rttMs: predictResponse.rttMs + resolveResponse.rttMs,
        computeMicros:
          predictResponse.computeMicros + resolveResponse.computeMicros,
        source: "edge",
        requestedKey: resolveResponse.requestedKey,
      };
    },
    [dimensions],
  );

  const step = useCallback(
    async (input: string | number[]): Promise<void> => {
      const turn = turnRef.current;
      const scenario = await resolveScenario(input, dimensions, turn);
      const naiveAction = naiveCacheRef.current.get(scenario.naiveKey);
      const baseTimestamp = elapsedMs(sessionStartRef.current);

      try {
        let outcome: StepOutcome;
        if (modeRef.current === "edge") {
          try {
            outcome = await runEdgeStep(scenario, turn);
            setEdgeStatus("ok");
            setEdgeError(null);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unknown edge failure";
            setEdgeStatus("fallback");
            setEdgeError(message);
            outcome = await runLocalStep(scenario);
          }
        } else {
          outcome = await runLocalStep(scenario);
          setEdgeStatus("idle");
          setEdgeError(null);
        }

        naiveCacheRef.current.set(scenario.naiveKey, outcome.prediction.action);
        turnRef.current = turn + 1;
        lastContextRef.current = [...scenario.contextVector];
        const nextStats = accumulateStats(statsRef.current, outcome.latency);
        statsRef.current = nextStats;
        setStats(nextStats);
        setTimeline((currentTimeline) =>
          currentTimeline
            .concat({
              step: nextStats.totalSteps,
              naive: nextStats.naiveTotalMs,
              velox: nextStats.veloxTotalMs,
              saved: nextStats.totalSavedMs,
              cacheHits: nextStats.cacheHits,
            })
            .slice(-MAX_HISTORY),
        );

        if (outcome.snapshot) {
          setSnapshot(outcome.snapshot);
          setSnapshotHistory((currentHistory) =>
            currentHistory
              .concat({
                step: nextStats.totalSteps,
                snapshot: outcome.snapshot as EngineSnapshot,
              })
              .slice(-MAX_HISTORY),
          );
        }

        setEdgeRttMs(outcome.rttMs);
        setEdgeComputeMicros(outcome.computeMicros);
        setActiveStepLabel(scenario.label);
        setLastAction(outcome.prediction.action);
        setEvents((currentEvents) =>
          currentEvents
            .concat(
              buildEvents(
                baseTimestamp,
                scenario,
                outcome.prediction,
                outcome.latency,
                naiveAction,
                outcome.source,
                outcome.rttMs,
                outcome.computeMicros,
                outcome.requestedKey,
              ),
            )
            .slice(-MAX_EVENTS),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown engine failure";
        setEdgeStatus("error");
        setEdgeError(message);
        setEvents((currentEvents) =>
          currentEvents
            .concat({
              timestamp: baseTimestamp,
              message:
                "[" +
                formatTimestamp(baseTimestamp) +
                "ms] Engine unavailable → " +
                message,
              action: "NO_OP",
              cacheHit: false,
            })
            .slice(-MAX_EVENTS),
        );
        throw error;
      }
    },
    [dimensions, runEdgeStep, runLocalStep],
  );

  const updateAlpha = useCallback((newAlpha: number): void => {
    const nextAlpha = clamp(newAlpha, 0.05, 4);
    alphaRef.current = nextAlpha;
    setAlphaState(nextAlpha);
    const engine = engineRef.current;
    if (engine === null) return;
    const updatedEngine = engine.withAlpha(nextAlpha);
    const lastContext = lastContextRef.current;
    if (lastContext) {
      const prediction = updatedEngine.predictNextAction(lastContext);
      setLastAction(prediction.action);
    }
    const nextSnapshot = safeSnapshot(updatedEngine);
    engineRef.current = updatedEngine;
    setSnapshot(nextSnapshot);
    if (nextSnapshot) {
      setSnapshotHistory((currentHistory) =>
        currentHistory
          .concat({ step: statsRef.current.totalSteps, snapshot: nextSnapshot })
          .slice(-MAX_HISTORY),
      );
    }
  }, []);

  const setMode = useCallback((nextMode: VeloxEngineMode): void => {
    modeRef.current = nextMode;
    setModeState(nextMode);
    setEdgeStatus("idle");
    setEdgeError(null);
  }, []);

  const reset = useCallback((): void => {
    resetLocalState();
  }, [resetLocalState]);

  const runJourney = useCallback(
    async (journeyId: string, delayMs = 240): Promise<void> => {
      const journey =
        journeys.find((candidate) => candidate.id === journeyId) ?? journeys[0];
      if (journey === undefined) return;
      for (const journeyStep of journey.steps) {
        await step(journeyStep.contextVector);
        if (delayMs > 0) await delay(delayMs);
      }
    },
    [step],
  );

  return {
    snapshot,
    snapshotHistory,
    stats,
    timeline,
    events,
    alpha,
    ready,
    activeStepLabel,
    lastAction,
    mode,
    edgeRttMs,
    edgeComputeMicros,
    edgeStatus,
    edgeError,
    step,
    setAlpha: updateAlpha,
    setMode,
    reset,
    runJourney,
  };
}
