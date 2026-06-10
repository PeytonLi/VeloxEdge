'use client';
// ═══════════════════════════════════════════════════════════════
// FROZEN CONTRACT (signature) — Agent B fills implementation.
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { LinUCBEngine } from '@veloxedge/bandit-engine';
import type { EngineSnapshot, PredictionResult } from '@veloxedge/bandit-engine';
import {
  COLD_FETCH_MS,
  NaiveStringCache,
  accumulateStats,
  computeLatency,
  embed,
  emptyStats,
  journeys,
} from '@/lib/simulation';
import type { JourneyStep, LatencyStats } from '@/lib/simulation';

export interface InterceptorEvent {
  timestamp: number; // ms since session start
  message: string;   // overlay stream line (e.g. "[014ms] Action: Pre-fetch DB Schema")
  action: string;
  cacheHit: boolean;
}

export interface VeloxEngineState {
  /** Bandit internal state for the math co-processor panels. */
  snapshot: EngineSnapshot | null;
  /** Running latency statistics for Section A counters. */
  stats: LatencyStats;
  /** Recent interceptor events for the Section C overlay stream. */
  events: InterceptorEvent[];
  /** Current α (may change via the What-If slider). */
  alpha: number;
  /** Whether the engine has been initialized. */
  ready: boolean;
}

export interface VeloxEngineActions {
  /**
   * Run one bandit step: embed input → predict action → simulate latency → update weights.
   * @param input - free-text from the console OR a JourneyStep context vector directly
   */
  step: (input: string | number[]) => Promise<void>;
  /** Change α live (rebuilds engine with withAlpha, preserves accumulated state). */
  setAlpha: (newAlpha: number) => void;
  /** Reset engine and stats to initial state. */
  reset: () => void;
  /** Run a full scripted journey sequentially (with ms delay between steps for animation). */
  runJourney: (journeyId: string, delayMs?: number) => Promise<void>;
}

const DEFAULT_DIMENSIONS = 12;
const DEFAULT_ALPHA = 1;
const MAX_EVENTS = 80;
const ACTIONS = ['TOOL_CONTEXT', 'EDGEKV_MEMORY', 'VECTOR_WEIGHTS', 'NO_OP'];

interface Scenario {
  contextVector: number[];
  bestAction: string;
  coldFetchMs: number;
  label: string;
  naiveKey: string;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clockNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function elapsedMs(sessionStart: number): number {
  return Math.max(0, Math.round(clockNow() - sessionStart));
}

function formatTimestamp(timestamp: number): string {
  return String(Math.max(0, Math.round(timestamp))).padStart(3, '0');
}

function resizeVector(values: number[], dimensions: number): number[] {
  const vector = values.slice(0, dimensions).map((value) => (Number.isFinite(value) ? value : 0));
  while (vector.length < dimensions) vector.push(0);
  return vector;
}

function dot(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let total = 0;
  for (let index = 0; index < length; index += 1) total += left[index] * right[index];
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

function nearestJourneyStep(contextVector: number[], dimensions: number): JourneyStep {
  const steps = allJourneySteps();
  let bestStep = steps[0];
  let bestScore = -Infinity;
  const resizedContext = resizeVector(contextVector, dimensions);

  for (const step of steps) {
    const score = cosineSimilarity(resizedContext, resizeVector(step.contextVector, dimensions));
    if (score > bestScore) {
      bestScore = score;
      bestStep = step;
    }
  }

  return bestStep ?? {
    label: 'Fallback local reasoning step',
    contextVector: resizedContext,
    bestAction: 'NO_OP',
    coldFetchMs: COLD_FETCH_MS,
  };
}

function normalizeInputLabel(input: string): string {
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : 'Untitled live prompt';
}

function resolveScenario(input: string | number[], dimensions: number, turn: number): Scenario {
  if (Array.isArray(input)) {
    const contextVector = resizeVector(input, dimensions);
    const step = nearestJourneyStep(contextVector, dimensions);

    return {
      contextVector,
      bestAction: step.bestAction,
      coldFetchMs: step.coldFetchMs,
      label: step.label,
      naiveKey: step.label + ' :: latent-turn=' + String(turn),
    };
  }

  const contextVector = embed(input, journeys, dimensions);
  const step = nearestJourneyStep(contextVector, dimensions);
  const label = normalizeInputLabel(input);

  return {
    contextVector,
    bestAction: step.bestAction,
    coldFetchMs: step.coldFetchMs,
    label,
    naiveKey: label.toLowerCase() + ' :: json_args_nonce=' + String(turn),
  };
}

function createEngine(dimensions: number, alpha: number): LinUCBEngine {
  return new LinUCBEngine({
    dimensions,
    alpha,
    actions: ACTIONS,
  });
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
    case 'TOOL_CONTEXT':
      return 'Pre-fetch tool context';
    case 'EDGEKV_MEMORY':
      return 'Pre-fetch EdgeKV memory';
    case 'VECTOR_WEIGHTS':
      return 'Pre-fetch vector weights';
    case 'NO_OP':
      return 'Hold cache line (NO_OP)';
    default:
      return action;
  }
}

function winningScore(prediction: PredictionResult): string {
  const winner = prediction.ucbBreakdown.find((entry) => entry.action === prediction.action);
  return winner === undefined ? 'n/a' : winner.ucbValue.toFixed(3);
}

function buildEvents(
  baseTimestamp: number,
  scenario: Scenario,
  prediction: PredictionResult,
  result: ReturnType<typeof computeLatency>,
  naiveAction: string | null,
): InterceptorEvent[] {
  const action = prediction.action;
  const baseline = naiveAction === null ? 'Naive cache MISS' : 'Naive cache HIT for ' + actionLabel(naiveAction);
  const outcome = result.cacheHit
    ? 'Local Cache Populated @ Akamai Edge in ' + String(result.latencyMs) + 'ms'
    : 'Origin cold pull: expected ' + actionLabel(scenario.bestAction) + ', paid ' + String(result.latencyMs) + 'ms';

  const event = (offset: number, message: string): InterceptorEvent => {
    const timestamp = baseTimestamp + offset;
    return {
      timestamp,
      message: '[' + formatTimestamp(timestamp) + 'ms] ' + message,
      action,
      cacheHit: result.cacheHit,
    };
  };

  return [
    event(0, 'Logit Stream Checked → ' + baseline),
    event(4, 'State Vector Identified → ' + scenario.label),
    event(9, 'Action: ' + actionLabel(action) + ' → UCB ' + winningScore(prediction)),
    event(14, outcome + ' → reward ' + result.reward.toFixed(3)),
  ];
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, delayMs));
  });
}

/**
 * React hook that owns the LinUCBEngine instance and drives the simulation.
 * Instantiates the engine client-side (no SSR). Holds all matrices in React state.
 *
 * @param _dimensions - context embedding dimension (default 12)
 * @param _alpha      - initial exploration parameter (default 1.0)
 */
export function useVeloxEngine(
  _dimensions?: number,
  _alpha?: number,
): VeloxEngineState & VeloxEngineActions {
  const dimensions = Math.max(1, Math.floor(_dimensions ?? DEFAULT_DIMENSIONS));
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [stats, setStats] = useState<LatencyStats>(() => emptyStats());
  const [events, setEvents] = useState<InterceptorEvent[]>([]);
  const [alpha, setAlphaState] = useState(() => clamp(_alpha ?? DEFAULT_ALPHA, 0.05, 4));
  const [ready, setReady] = useState(false);

  const engineRef = useRef<LinUCBEngine | null>(null);
  const naiveCacheRef = useRef(new NaiveStringCache());
  const sessionStartRef = useRef(clockNow());
  const turnRef = useRef(0);

  useEffect(() => {
    const engine = createEngine(dimensions, alpha);
    engineRef.current = engine;
    naiveCacheRef.current.clear();
    sessionStartRef.current = clockNow();
    turnRef.current = 0;
    setSnapshot(safeSnapshot(engine));
    setStats(emptyStats());
    setEvents([]);
    setReady(true);

    return () => {
      engineRef.current = null;
      setReady(false);
    };
  }, [dimensions]);

  const step = useCallback(
    async (input: string | number[]): Promise<void> => {
      let engine = engineRef.current;
      if (engine === null) {
        engine = createEngine(dimensions, alpha);
        engineRef.current = engine;
        setReady(true);
      }

      const turn = turnRef.current;
      const scenario = resolveScenario(input, dimensions, turn);
      const naiveAction = naiveCacheRef.current.get(scenario.naiveKey);
      const baseTimestamp = elapsedMs(sessionStartRef.current);

      try {
        const prediction = engine.predictNextAction(scenario.contextVector);
        const result = computeLatency(prediction.action, scenario.bestAction, scenario.coldFetchMs);

        naiveCacheRef.current.set(scenario.naiveKey, scenario.bestAction);
        engine.updateWeights(prediction.action, scenario.contextVector, result.reward);
        turnRef.current = turn + 1;

        setStats((currentStats) => accumulateStats(currentStats, result));
        setSnapshot(safeSnapshot(engine));
        setEvents((currentEvents) =>
          currentEvents.concat(buildEvents(baseTimestamp, scenario, prediction, result, naiveAction)).slice(-MAX_EVENTS),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown engine failure';
        setEvents((currentEvents) =>
          currentEvents
            .concat({
              timestamp: baseTimestamp,
              message: '[' + formatTimestamp(baseTimestamp) + 'ms] Engine unavailable → ' + message,
              action: 'NO_OP',
              cacheHit: false,
            })
            .slice(-MAX_EVENTS),
        );
        throw error;
      }
    },
    [alpha, dimensions],
  );

  const updateAlpha = useCallback(
    (newAlpha: number): void => {
      const nextAlpha = clamp(newAlpha, 0.05, 4);
      setAlphaState(nextAlpha);

      const engine = engineRef.current;
      if (engine === null) return;

      const updatedEngine = engine.withAlpha(nextAlpha);
      engineRef.current = updatedEngine;
      setSnapshot(safeSnapshot(updatedEngine));
    },
    [],
  );

  const reset = useCallback((): void => {
    const engine = createEngine(dimensions, alpha);
    engineRef.current = engine;
    naiveCacheRef.current.clear();
    sessionStartRef.current = clockNow();
    turnRef.current = 0;
    setSnapshot(safeSnapshot(engine));
    setStats(emptyStats());
    setEvents([]);
    setReady(true);
  }, [alpha, dimensions]);

  const runJourney = useCallback(
    async (journeyId: string, delayMs = 240): Promise<void> => {
      const journey = journeys.find((candidate) => candidate.id === journeyId) ?? journeys[0];
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
    stats,
    events,
    alpha,
    ready,
    step,
    setAlpha: updateAlpha,
    reset,
    runJourney,
  };
}
