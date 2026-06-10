"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LinUCBEngine } from "@veloxedge/bandit-engine";
import type { EdgePredictResponse, EdgeUpdateResponse, EngineSnapshot, PredictionResult } from "@veloxedge/bandit-engine";
import { edgeClient, type EdgeClientResponse } from "@/lib/edge/edgeClient";
import { COLD_FETCH_MS, NaiveStringCache, accumulateStats, computeLatency, embed, emptyStats, journeys } from "@/lib/simulation";
import type { JourneyStep, LatencyResult, LatencyStats } from "@/lib/simulation";

export type VeloxEngineMode = "local" | "edge";
export type EdgeStatus = "idle" | "ok" | "fallback" | "error";

export interface InterceptorEvent { timestamp: number; message: string; action: string; cacheHit: boolean; }
export interface TelemetryPoint { step: number; naive: number; velox: number; saved: number; cacheHits: number; }
export interface SnapshotTelemetryPoint { step: number; snapshot: EngineSnapshot; }

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
const ACTIONS = ["TOOL_CONTEXT", "EDGEKV_MEMORY", "VECTOR_WEIGHTS", "NO_OP"];
const DEFAULT_ACTION = ACTIONS[0];
const INITIAL_STEP_LABEL = "Awaiting first latent trajectory";

interface Scenario { contextVector: number[]; bestAction: string; coldFetchMs: number; label: string; naiveKey: string; }
interface StepOutcome { prediction: PredictionResult; latency: LatencyResult; snapshot: EngineSnapshot | null; rttMs: number | null; computeMicros: number | null; source: VeloxEngineMode; }

function createInitialTelemetryPoint(): TelemetryPoint { return { step: 0, naive: 0, velox: 0, saved: 0, cacheHits: 0 }; }
function clamp(value: number, min: number, max: number): number { return Number.isNaN(value) ? min : Math.max(min, Math.min(max, value)); }
function clockNow(): number { return typeof performance === "undefined" ? Date.now() : performance.now(); }
function elapsedMs(sessionStart: number): number { return Math.max(0, Math.round(clockNow() - sessionStart)); }
function formatTimestamp(timestamp: number): string { return String(Math.max(0, Math.round(timestamp))).padStart(3, "0"); }
function resizeVector(values: number[], dimensions: number): number[] { const vector = values.slice(0, dimensions).map((value) => Number.isFinite(value) ? value : 0); while (vector.length < dimensions) vector.push(0); return vector; }
function dot(left: number[], right: number[]): number { let total = 0; for (let index = 0; index < Math.min(left.length, right.length); index += 1) total += left[index] * right[index]; return total; }
function magnitude(values: number[]): number { return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1; }
function cosineSimilarity(left: number[], right: number[]): number { return dot(left, right) / (magnitude(left) * magnitude(right)); }
function allJourneySteps(): JourneyStep[] { return journeys.flatMap((journey) => journey.steps); }

function nearestJourneyStep(contextVector: number[], dimensions: number): JourneyStep {
  const steps = allJourneySteps();
  let bestStep = steps[0];
  let bestScore = -Infinity;
  const resizedContext = resizeVector(contextVector, dimensions);
  for (const step of steps) {
    const score = cosineSimilarity(resizedContext, resizeVector(step.contextVector, dimensions));
    if (score > bestScore) { bestScore = score; bestStep = step; }
  }
  return bestStep ?? { label: "Fallback local reasoning step", contextVector: resizedContext, bestAction: "NO_OP", coldFetchMs: COLD_FETCH_MS };
}

function normalizeInputLabel(input: string): string { const trimmed = input.trim(); return trimmed.length > 0 ? trimmed : "Untitled live prompt"; }

function resolveScenario(input: string | number[], dimensions: number, turn: number): Scenario {
  if (Array.isArray(input)) {
    const contextVector = resizeVector(input, dimensions);
    const step = nearestJourneyStep(contextVector, dimensions);
    return { contextVector, bestAction: step.bestAction, coldFetchMs: step.coldFetchMs, label: step.label, naiveKey: step.label + " :: latent-turn=" + String(turn) };
  }
  const contextVector = embed(input, journeys, dimensions);
  const step = nearestJourneyStep(contextVector, dimensions);
  const label = normalizeInputLabel(input);
  return { contextVector, bestAction: step.bestAction, coldFetchMs: step.coldFetchMs, label, naiveKey: label.toLowerCase() + " :: json_args_nonce=" + String(turn) };
}

function createEngine(dimensions: number, alpha: number): LinUCBEngine { return new LinUCBEngine({ dimensions, alpha, actions: ACTIONS }); }
function safeSnapshot(engine: LinUCBEngine): EngineSnapshot | null { try { return engine.snapshot(); } catch { return null; } }

function actionLabel(action: string): string {
  switch (action) {
    case "TOOL_CONTEXT": return "Pre-fetch tool context";
    case "EDGEKV_MEMORY": return "Pre-fetch EdgeKV memory";
    case "VECTOR_WEIGHTS": return "Pre-fetch vector weights";
    case "NO_OP": return "Hold cache line (NO_OP)";
    default: return action;
  }
}

function winningScore(prediction: PredictionResult): string {
  const winner = prediction.ucbBreakdown.find((entry) => entry.action === prediction.action);
  return winner === undefined ? "n/a" : winner.ucbValue.toFixed(3);
}

function predictionFromEdge(response: EdgePredictResponse): PredictionResult { return { action: response.action, ucbBreakdown: response.ucbBreakdown }; }

function updatePredictionFromEdge(response: EdgeUpdateResponse, fallbackAction: string): PredictionResult {
  const best = response.ucbBreakdown.reduce((winner, entry) => !winner || entry.ucbValue > winner.ucbValue ? entry : winner, response.ucbBreakdown[0]);
  return { action: best?.action ?? fallbackAction, ucbBreakdown: response.ucbBreakdown };
}

function buildEvents(baseTimestamp: number, scenario: Scenario, prediction: PredictionResult, result: LatencyResult, naiveAction: string | null, mode: VeloxEngineMode, rttMs: number | null, computeMicros: number | null): InterceptorEvent[] {
  const action = prediction.action;
  const baseline = naiveAction === null ? "Naive cache MISS" : "Naive cache HIT for " + actionLabel(naiveAction);
  const runtime = mode === "edge" ? "LIVE EDGE rtt=" + (rttMs?.toFixed(1) ?? "n/a") + "ms compute=" + (computeMicros ?? 0) + "µs" : "LOCAL fallback compute in browser";
  const outcome = result.cacheHit ? "Local Cache Populated @ Akamai Edge in " + String(result.latencyMs) + "ms" : "Origin cold pull: expected " + actionLabel(scenario.bestAction) + ", paid " + String(result.latencyMs) + "ms";
  const event = (offset: number, message: string): InterceptorEvent => {
    const timestamp = baseTimestamp + offset;
    return { timestamp, message: "[" + formatTimestamp(timestamp) + "ms] " + message, action, cacheHit: result.cacheHit };
  };
  return [
    event(0, "Logit Stream Checked → " + baseline),
    event(4, "State Vector Identified → " + scenario.label),
    event(9, runtime + " → " + actionLabel(action) + " UCB " + winningScore(prediction)),
    event(14, outcome + " → reward " + result.reward.toFixed(3)),
  ];
}

function delay(delayMs: number): Promise<void> { return new Promise((resolve) => { window.setTimeout(resolve, Math.max(0, delayMs)); }); }
function makeSessionId(): string { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "velox-" + Math.random().toString(36).slice(2); }

export function useVeloxEngine(_dimensions?: number, _alpha?: number): VeloxEngineState & VeloxEngineActions {
  const dimensions = Math.max(1, Math.floor(_dimensions ?? DEFAULT_DIMENSIONS));
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [snapshotHistory, setSnapshotHistory] = useState<SnapshotTelemetryPoint[]>([]);
  const [stats, setStats] = useState<LatencyStats>(() => emptyStats());
  const [timeline, setTimeline] = useState<TelemetryPoint[]>(() => [createInitialTelemetryPoint()]);
  const [events, setEvents] = useState<InterceptorEvent[]>([]);
  const [alpha, setAlphaState] = useState(() => clamp(_alpha ?? DEFAULT_ALPHA, 0.05, 4));
  const [ready, setReady] = useState(false);
  const [activeStepLabel, setActiveStepLabel] = useState(INITIAL_STEP_LABEL);
  const [lastAction, setLastAction] = useState(DEFAULT_ACTION);
  const [mode, setModeState] = useState<VeloxEngineMode>("local");
  const [edgeRttMs, setEdgeRttMs] = useState<number | null>(null);
  const [edgeComputeMicros, setEdgeComputeMicros] = useState<number | null>(null);
  const [edgeStatus, setEdgeStatus] = useState<EdgeStatus>("idle");
  const [edgeError, setEdgeError] = useState<string | null>(null);

  const engineRef = useRef<LinUCBEngine | null>(null);
  const naiveCacheRef = useRef(new NaiveStringCache());
  const statsRef = useRef<LatencyStats>(emptyStats());
  const lastContextRef = useRef<number[] | null>(null);
  const sessionStartRef = useRef(clockNow());
  const turnRef = useRef(0);
  const modeRef = useRef<VeloxEngineMode>("local");
  const sessionId = useMemo(makeSessionId, []);

  const resetLocalState = useCallback(() => {
    const engine = createEngine(dimensions, alpha);
    const initialSnapshot = safeSnapshot(engine);
    const initialStats = emptyStats();
    engineRef.current = engine;
    naiveCacheRef.current.clear();
    statsRef.current = initialStats;
    lastContextRef.current = null;
    sessionStartRef.current = clockNow();
    turnRef.current = 0;
    setSnapshot(initialSnapshot);
    setSnapshotHistory(initialSnapshot ? [{ step: 0, snapshot: initialSnapshot }] : []);
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
  }, [alpha, dimensions]);

  useEffect(() => {
    resetLocalState();
    return () => { engineRef.current = null; };
  }, [dimensions, resetLocalState]);

  const runLocalStep = useCallback((scenario: Scenario): StepOutcome => {
    let engine = engineRef.current;
    if (engine === null) {
      engine = createEngine(dimensions, alpha);
      engineRef.current = engine;
      setReady(true);
    }
    const prediction = engine.predictNextAction(scenario.contextVector);
    const latency = computeLatency(prediction.action, scenario.bestAction, scenario.coldFetchMs);
    engine.updateWeights(prediction.action, scenario.contextVector, latency.reward);
    return { prediction, latency, snapshot: safeSnapshot(engine), rttMs: null, computeMicros: null, source: "local" };
  }, [alpha, dimensions]);

  const runEdgeStep = useCallback(async (scenario: Scenario): Promise<StepOutcome> => {
    const requestConfig = { sessionId, dimensions, alpha, actions: ACTIONS };
    const predictResponse: EdgeClientResponse<EdgePredictResponse> = await edgeClient.predict({ ...requestConfig, contextVector: scenario.contextVector });
    const prediction = predictionFromEdge(predictResponse);
    const latency = computeLatency(prediction.action, scenario.bestAction, scenario.coldFetchMs);
    const updateResponse: EdgeClientResponse<EdgeUpdateResponse> = await edgeClient.update({ ...requestConfig, action: prediction.action, contextVector: scenario.contextVector, reward: latency.reward });
    const updatePrediction = updatePredictionFromEdge(updateResponse, prediction.action);
    return {
      prediction: updatePrediction.ucbBreakdown.length > 0 ? updatePrediction : prediction,
      latency,
      snapshot: null,
      rttMs: predictResponse.rttMs + updateResponse.rttMs,
      computeMicros: predictResponse.computeMicros + updateResponse.computeMicros,
      source: "edge",
    };
  }, [alpha, dimensions, sessionId]);

  const step = useCallback(async (input: string | number[]): Promise<void> => {
    const turn = turnRef.current;
    const scenario = resolveScenario(input, dimensions, turn);
    const naiveAction = naiveCacheRef.current.get(scenario.naiveKey);
    const baseTimestamp = elapsedMs(sessionStartRef.current);

    try {
      let outcome: StepOutcome;
      if (modeRef.current === "edge") {
        try {
          outcome = await runEdgeStep(scenario);
          setEdgeStatus("ok");
          setEdgeError(null);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown edge failure";
          setEdgeStatus("fallback");
          setEdgeError(message);
          outcome = runLocalStep(scenario);
        }
      } else {
        outcome = runLocalStep(scenario);
        setEdgeStatus("idle");
        setEdgeError(null);
      }

      naiveCacheRef.current.set(scenario.naiveKey, scenario.bestAction);
      turnRef.current = turn + 1;
      lastContextRef.current = [...scenario.contextVector];
      const nextStats = accumulateStats(statsRef.current, outcome.latency);
      statsRef.current = nextStats;
      setStats(nextStats);
      setTimeline((currentTimeline) => currentTimeline.concat({ step: nextStats.totalSteps, naive: nextStats.naiveTotalMs, velox: nextStats.veloxTotalMs, saved: nextStats.totalSavedMs, cacheHits: nextStats.cacheHits }).slice(-MAX_HISTORY));

      if (outcome.snapshot) {
        setSnapshot(outcome.snapshot);
        setSnapshotHistory((currentHistory) => currentHistory.concat({ step: nextStats.totalSteps, snapshot: outcome.snapshot as EngineSnapshot }).slice(-MAX_HISTORY));
      }

      setEdgeRttMs(outcome.rttMs);
      setEdgeComputeMicros(outcome.computeMicros);
      setActiveStepLabel(scenario.label);
      setLastAction(outcome.prediction.action);
      setEvents((currentEvents) => currentEvents.concat(buildEvents(baseTimestamp, scenario, outcome.prediction, outcome.latency, naiveAction, outcome.source, outcome.rttMs, outcome.computeMicros)).slice(-MAX_EVENTS));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown engine failure";
      setEdgeStatus("error");
      setEdgeError(message);
      setEvents((currentEvents) => currentEvents.concat({ timestamp: baseTimestamp, message: "[" + formatTimestamp(baseTimestamp) + "ms] Engine unavailable → " + message, action: "NO_OP", cacheHit: false }).slice(-MAX_EVENTS));
      throw error;
    }
  }, [dimensions, runEdgeStep, runLocalStep]);

  const updateAlpha = useCallback((newAlpha: number): void => {
    const nextAlpha = clamp(newAlpha, 0.05, 4);
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
      setSnapshotHistory((currentHistory) => currentHistory.concat({ step: statsRef.current.totalSteps, snapshot: nextSnapshot }).slice(-MAX_HISTORY));
    }
  }, []);

  const setMode = useCallback((nextMode: VeloxEngineMode): void => {
    modeRef.current = nextMode;
    setModeState(nextMode);
    setEdgeStatus("idle");
    setEdgeError(null);
  }, []);

  const reset = useCallback((): void => { resetLocalState(); }, [resetLocalState]);

  const runJourney = useCallback(async (journeyId: string, delayMs = 240): Promise<void> => {
    const journey = journeys.find((candidate) => candidate.id === journeyId) ?? journeys[0];
    if (journey === undefined) return;
    for (const journeyStep of journey.steps) {
      await step(journeyStep.contextVector);
      if (delayMs > 0) await delay(delayMs);
    }
  }, [step]);

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
