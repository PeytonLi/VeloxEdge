'use client';
// ═══════════════════════════════════════════════════════════════
// FROZEN CONTRACT (signature) — Agent B fills implementation.
// ═══════════════════════════════════════════════════════════════

import type { EngineSnapshot } from '@veloxedge/bandit-engine';
import type { LatencyStats } from '@/lib/simulation';

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

const NOT_IMPL = () => { throw new Error('useVeloxEngine: Not implemented — Agent B'); };

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
  // Agent B replaces this stub with the full hook implementation.
  // Stub returns a type-safe placeholder so the dashboard builds with stubs in place.
  return {
    snapshot: null,
    stats: {
      totalSteps: 0,
      cacheHits: 0,
      coldFetches: 0,
      totalSavedMs: 0,
      naiveTotalMs: 0,
      veloxTotalMs: 0,
    },
    events: [],
    alpha: _alpha ?? 1.0,
    ready: false,
    step: NOT_IMPL as unknown as (input: string | number[]) => Promise<void>,
    setAlpha: NOT_IMPL,
    reset: NOT_IMPL,
    runJourney: NOT_IMPL as unknown as (journeyId: string, delayMs?: number) => Promise<void>,
  };
}
