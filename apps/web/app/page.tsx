"use client";

import { useMemo, useReducer, useState } from "react";
import type { EngineSnapshot } from "@veloxedge/bandit-engine";
import { useVeloxEngine } from "@/hooks/useVeloxEngine";
import type { InterceptorEvent } from "@/hooks/useVeloxEngine";
import { journeys as scriptedJourneys } from "@/lib/simulation";
import type { Journey, JourneyStep, LatencyStats } from "@/lib/simulation";
import Console from "@/components/Console";
import InterceptorOverlay from "@/components/InterceptorOverlay";
import LatencyPanel from "@/components/LatencyPanel";
import CounterCards from "@/components/CounterCards";
import CovarianceHeatmap from "@/components/CovarianceHeatmap";
import ConvergenceChart from "@/components/ConvergenceChart";
import WhatIfBoard from "@/components/WhatIfBoard";
import {
  ACTIONS,
  DEFAULT_ALPHA,
  DEMO_JOURNEYS,
  FALLBACK_EDGE_HIT_MS,
  buildFallbackEvents,
  calculateImprovement,
  classifyPromptAction,
  createDemoSnapshot,
  createEmptyStats,
  initialConvergence,
  initialTimeline,
  snapshotToConvergencePoint,
  type ConvergencePoint,
  type TimelinePoint,
} from "@/components/dashboardData";

interface DemoState {
  tick: number;
  stats: LatencyStats;
  events: InterceptorEvent[];
  snapshot: EngineSnapshot;
  timeline: TimelinePoint[];
  convergence: ConvergencePoint[];
  lastAction: string;
  activeStepLabel: string;
}

type DemoAction =
  | {
      type: "step";
      journey: Journey;
      prompt?: string;
      step?: JourneyStep;
      alpha: number;
    }
  | { type: "alpha"; alpha: number }
  | { type: "reset"; alpha: number };

function createInitialDemoState(alpha: number): DemoState {
  const snapshot = createDemoSnapshot(alpha, 0, "TOOL_CONTEXT");
  return {
    tick: 0,
    stats: createEmptyStats(),
    events: buildFallbackEvents(
      0,
      "TOOL_CONTEXT",
      "Awaiting first latent trajectory",
      true,
    ),
    snapshot,
    timeline: initialTimeline(),
    convergence: initialConvergence(),
    lastAction: "TOOL_CONTEXT",
    activeStepLabel: "Awaiting first latent trajectory",
  };
}

function chooseMissAction(bestAction: string, tick: number): string {
  const options = ACTIONS.filter((action) => action !== bestAction);
  return options[tick % options.length] ?? "NO_OP";
}

function demoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === "reset") return createInitialDemoState(action.alpha);
  if (action.type === "alpha") {
    const snapshot = createDemoSnapshot(
      action.alpha,
      state.tick,
      state.lastAction,
    );
    return {
      ...state,
      snapshot,
      convergence: [
        ...state.convergence.slice(-15),
        snapshotToConvergencePoint(snapshot, state.tick),
      ],
    };
  }

  const nextTick = state.tick + 1;
  const steps =
    action.journey.steps.length > 0
      ? action.journey.steps
      : DEMO_JOURNEYS[0].steps;
  const journeyStep =
    action.step ??
    steps[state.tick % steps.length] ??
    DEMO_JOURNEYS[0].steps[0];
  const prompt = action.prompt?.trim() ?? "";
  const bestAction =
    prompt.length > 0 ? classifyPromptAction(prompt) : journeyStep.bestAction;
  const warmedUp = nextTick > 1;
  const explorationMiss = action.alpha > 1.55 && nextTick % 4 === 0;
  const budgetGuard = bestAction === "NO_OP";
  const cacheHit = warmedUp && !explorationMiss && !budgetGuard;
  const predictedAction = cacheHit
    ? bestAction
    : chooseMissAction(bestAction, nextTick);
  const coldFetchMs = Math.max(
    620,
    journeyStep.coldFetchMs + (prompt.length % 5) * 18,
  );
  const naiveLatency = coldFetchMs + 42 + (nextTick % 3) * 24;
  const veloxLatency = cacheHit
    ? FALLBACK_EDGE_HIT_MS + (nextTick % 2) * 3
    : coldFetchMs + 78;
  const savedMs = Math.max(0, naiveLatency - veloxLatency);
  const stats: LatencyStats = {
    totalSteps: state.stats.totalSteps + 1,
    cacheHits: state.stats.cacheHits + (cacheHit ? 1 : 0),
    coldFetches: state.stats.coldFetches + (cacheHit ? 0 : 1),
    totalSavedMs: state.stats.totalSavedMs + savedMs,
    naiveTotalMs: state.stats.naiveTotalMs + naiveLatency,
    veloxTotalMs: state.stats.veloxTotalMs + veloxLatency,
  };
  const snapshot = createDemoSnapshot(action.alpha, nextTick, predictedAction);
  const label =
    prompt.length > 0 ? `Free-text prompt: ${prompt}` : journeyStep.label;

  return {
    tick: nextTick,
    stats,
    events: [
      ...buildFallbackEvents(nextTick, predictedAction, label, cacheHit),
      ...state.events,
    ].slice(0, 18),
    snapshot,
    timeline: [
      ...state.timeline,
      {
        step: stats.totalSteps,
        naive: stats.naiveTotalMs,
        velox: stats.veloxTotalMs,
        saved: stats.totalSavedMs,
        cacheHits: stats.cacheHits,
      },
    ].slice(-18),
    convergence: [
      ...state.convergence,
      snapshotToConvergencePoint(snapshot, stats.totalSteps),
    ].slice(-18),
    lastAction: predictedAction,
    activeStepLabel: label,
  };
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export default function Dashboard() {
  const engine = useVeloxEngine(12, DEFAULT_ALPHA);
  const availableJourneys =
    scriptedJourneys.length > 0 ? scriptedJourneys : DEMO_JOURNEYS;
  const [selectedJourneyId, setSelectedJourneyId] = useState(
    availableJourneys[0]?.id ?? DEMO_JOURNEYS[0].id,
  );
  const [prompt, setPrompt] = useState(
    "Analyze Q4 churn, load the warehouse schema, then rank anomalous regions",
  );
  const [demo, dispatchDemo] = useReducer(
    demoReducer,
    DEFAULT_ALPHA,
    createInitialDemoState,
  );
  const [fallbackAlpha, setFallbackAlpha] = useState(DEFAULT_ALPHA);
  const [isRunning, setIsRunning] = useState(false);

  const selectedJourney = useMemo(() => {
    return (
      availableJourneys.find((journey) => journey.id === selectedJourneyId) ??
      availableJourneys[0] ??
      DEMO_JOURNEYS[0]
    );
  }, [availableJourneys, selectedJourneyId]);

  const hasRealTelemetry =
    engine.ready ||
    engine.stats.totalSteps > 0 ||
    engine.events.length > 0 ||
    engine.snapshot !== null;
  const alpha = hasRealTelemetry ? engine.alpha : fallbackAlpha;
  const displayStats = hasRealTelemetry ? engine.stats : demo.stats;
  const displaySnapshot =
    (hasRealTelemetry ? engine.snapshot : demo.snapshot) ?? demo.snapshot;
  const displayEvents =
    hasRealTelemetry && engine.events.length > 0 ? engine.events : demo.events;
  const displayTimeline =
    hasRealTelemetry && engine.timeline.length > 0
      ? engine.timeline
      : demo.timeline;
  const displayConvergence =
    hasRealTelemetry && engine.snapshotHistory.length > 1
      ? engine.snapshotHistory.map(({ step, snapshot }) =>
          snapshotToConvergencePoint(snapshot, step),
        )
      : demo.convergence;
  const activeAction = hasRealTelemetry
    ? engine.lastAction
    : (displaySnapshot.lastUcb[0]?.action ?? demo.lastAction);
  const activeStepLabel = hasRealTelemetry
    ? engine.activeStepLabel
    : demo.activeStepLabel;
  const improvement = calculateImprovement(displayStats);

  const runRealStep = async (input: string | number[]) => {
    if (!engine.ready) return false;
    try {
      await engine.step(input);
      return true;
    } catch {
      return false;
    }
  };

  const handleStep = async () => {
    setIsRunning(true);
    const nextJourneyStep =
      selectedJourney.steps[
        displayStats.totalSteps % Math.max(1, selectedJourney.steps.length)
      ];
    const input =
      prompt.trim().length > 0
        ? prompt
        : (nextJourneyStep?.contextVector ?? prompt);
    const usedRealEngine = await runRealStep(input);
    if (!usedRealEngine)
      dispatchDemo({
        type: "step",
        journey: selectedJourney,
        prompt,
        alpha: fallbackAlpha,
      });
    setIsRunning(false);
  };

  const handleRunJourney = async () => {
    setIsRunning(true);
    let usedRealEngine = false;
    if (engine.ready) {
      try {
        await engine.runJourney(selectedJourney.id, 170);
        usedRealEngine = true;
      } catch {
        usedRealEngine = false;
      }
    }

    if (!usedRealEngine) {
      const steps =
        selectedJourney.steps.length > 0
          ? selectedJourney.steps
          : DEMO_JOURNEYS[0].steps;
      for (const step of steps) {
        dispatchDemo({
          type: "step",
          journey: selectedJourney,
          step,
          alpha: fallbackAlpha,
        });
        await delay(170);
      }
    }
    setIsRunning(false);
  };

  const handleReset = () => {
    if (engine.ready) {
      try {
        engine.reset();
      } catch {
        // The Agent C fallback remains interactive until Agent B wires the hook.
      }
    }
    dispatchDemo({ type: "reset", alpha: fallbackAlpha });
  };

  const handleAlphaChange = (newAlpha: number) => {
    setFallbackAlpha(newAlpha);
    dispatchDemo({ type: "alpha", alpha: newAlpha });
    if (engine.ready) {
      try {
        engine.setAlpha(newAlpha);
      } catch {
        // Ignore placeholder hook errors in the UI-only worktree.
      }
    }
  };

  return (
    <main className="dashboard-shell">
      <div className="ambient-orbit ambient-orbit-one" aria-hidden="true" />
      <div className="ambient-orbit ambient-orbit-two" aria-hidden="true" />
      <header className="hero-bar">
        <div className="brand-lockup">
          <span className="brand-sigil">VE</span>
          <div>
            <p className="eyebrow">
              Predictive edge cache for agentic workflows
            </p>
            <h1>VeloxEdge</h1>
          </div>
        </div>
        <div className="hero-metrics" aria-label="Session summary">
          <span>
            <strong>{displayStats.totalSteps}</strong> turns observed
          </span>
          <span>
            <strong>{improvement.toFixed(0)}%</strong> latency dividend
          </span>
          <span>
            <strong>{alpha.toFixed(2)}</strong> α exploration
          </span>
        </div>
      </header>

      <div className="zone-grid">
        <section id="zone-a" className="dashboard-zone zone-analytics">
          <div className="zone-heading">
            <span>A · Latency Analytics</span>
            <em>Naive cache vs speculative LinUCB prefetch</em>
          </div>
          <CounterCards
            stats={displayStats}
            improvement={improvement}
            activeAction={activeAction}
            ready={engine.ready}
          />
          <LatencyPanel data={displayTimeline} improvement={improvement} />
        </section>

        <section id="zone-c" className="dashboard-zone zone-simulation">
          <div className="zone-heading">
            <span>C · Active Simulation</span>
            <em>Console, action stream, microsecond edge stepper</em>
          </div>
          <Console
            journeys={availableJourneys}
            selectedJourneyId={selectedJourney.id}
            prompt={prompt}
            onPromptChange={setPrompt}
            onSelectJourney={setSelectedJourneyId}
            onStep={handleStep}
            onRunJourney={handleRunJourney}
            onReset={handleReset}
            isRunning={isRunning}
            ready={engine.ready}
            alpha={alpha}
            activeStepLabel={activeStepLabel}
          />
          <InterceptorOverlay
            events={displayEvents}
            activeAction={activeAction}
            activeStepLabel={activeStepLabel}
            ready={engine.ready}
          />
        </section>

        <section id="zone-b" className="dashboard-zone zone-math">
          <div className="zone-heading">
            <span>B · Math Co-processor</span>
            <em>Variance collapse, θ̂ convergence, exploration control</em>
          </div>
          <CovarianceHeatmap
            snapshot={displaySnapshot}
            activeAction={activeAction}
          />
          <ConvergenceChart data={displayConvergence} />
          <WhatIfBoard
            alpha={alpha}
            onAlphaChange={handleAlphaChange}
            activeAction={activeAction}
            dimensions={12}
            ready={engine.ready}
          />
        </section>
      </div>
    </main>
  );
}
