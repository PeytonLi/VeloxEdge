import {
  LinUCBEngine,
  type EdgePredictRequest,
  type EdgePredictResponse,
  type EdgeUpdateRequest,
  type EdgeUpdateResponse,
  type SerializedEngineState,
} from "@veloxedge/bandit-engine";

export interface EdgeKvEmulator {
  predict(request: EdgePredictRequest): Promise<EdgePredictResponse>;
  update(request: EdgeUpdateRequest): Promise<EdgeUpdateResponse>;
  reset(sessionId: string): Promise<void>;
}

const states = new Map<string, SerializedEngineState>();
const engineFallbacks = new Map<string, LinUCBEngine>();

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function computeMicros(startedAt: number): number {
  return Math.max(0, Math.round((nowMs() - startedAt) * 1000));
}

function makeEngine(request: EdgePredictRequest | EdgeUpdateRequest): LinUCBEngine {
  return new LinUCBEngine({
    dimensions: request.dimensions,
    alpha: request.alpha,
    actions: request.actions,
  });
}

function configMatches(
  state: SerializedEngineState,
  request: EdgePredictRequest | EdgeUpdateRequest,
): boolean {
  return (
    state.dimensions === request.dimensions &&
    state.actions.length === request.actions.length &&
    state.actions.every((action, index) => action === request.actions[index])
  );
}

function restoreEngine(request: EdgePredictRequest | EdgeUpdateRequest): LinUCBEngine {
  const state = states.get(request.sessionId);

  if (state && configMatches(state, request)) {
    try {
      const restored = LinUCBEngine.deserialize(state);
      return restored.getAlpha() === request.alpha
        ? restored
        : restored.withAlpha(request.alpha);
    } catch {
      // Agent E1 owns serialize/deserialize. Until that branch lands, keep the
      // emulator live via an in-memory engine cache and switch automatically
      // to SerializedEngineState once the real methods exist.
    }
  }

  const cached = engineFallbacks.get(request.sessionId);
  if (cached) {
    return cached.getAlpha() === request.alpha ? cached : cached.withAlpha(request.alpha);
  }

  return makeEngine(request);
}

function persistEngine(sessionId: string, engine: LinUCBEngine): void {
  engineFallbacks.set(sessionId, engine);

  try {
    states.set(sessionId, engine.serialize());
  } catch {
    states.delete(sessionId);
  }
}

export function createEdgeKvEmulator(): EdgeKvEmulator {
  return {
    async predict(request) {
      const startedAt = nowMs();
      const engine = restoreEngine(request);
      const prediction = engine.predictNextAction(request.contextVector);
      persistEngine(request.sessionId, engine);

      return {
        sessionId: request.sessionId,
        action: prediction.action,
        ucbBreakdown: prediction.ucbBreakdown,
        computeMicros: computeMicros(startedAt),
      };
    },

    async update(request) {
      const startedAt = nowMs();
      const engine = restoreEngine(request);
      engine.updateWeights(request.action, request.contextVector, request.reward);
      const prediction = engine.predictNextAction(request.contextVector);
      persistEngine(request.sessionId, engine);

      return {
        sessionId: request.sessionId,
        action: request.action,
        ucbBreakdown: prediction.ucbBreakdown,
        computeMicros: computeMicros(startedAt),
      };
    },

    async reset(sessionId) {
      states.delete(sessionId);
      engineFallbacks.delete(sessionId);
    },
  };
}

export const edgeKvEmulator = createEdgeKvEmulator();
