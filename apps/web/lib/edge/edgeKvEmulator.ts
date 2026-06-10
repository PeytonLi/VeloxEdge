import {
  LinUCBEngine,
  deriveAssetKey,
  rewardFromLatency,
  type EdgeEngineConfig,
  type EdgePredictRequest,
  type EdgePredictResponse,
  type EdgeResolveRequest,
  type EdgeResolveResponse,
  type EdgeUpdateRequest,
  type EdgeUpdateResponse,
  type PendingPrediction,
  type SerializedEngineState,
} from "@veloxedge/bandit-engine";

export interface EdgeKvEmulator {
  predict(request: EdgePredictRequest): Promise<EdgePredictResponse>;
  update(request: EdgeUpdateRequest): Promise<EdgeUpdateResponse>;
  resolve(request: EdgeResolveRequest): Promise<EdgeResolveResponse>;
  reset(sessionId: string): Promise<void>;
}

type RuntimeRequest = EdgePredictRequest | EdgeUpdateRequest;

const states = new Map<string, SerializedEngineState>();
const engineFallbacks = new Map<string, LinUCBEngine>();
const pendingPredictions = new Map<string, PendingPrediction>();

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function computeMicros(startedAt: number): number {
  return Math.max(0, Math.round((nowMs() - startedAt) * 1000));
}

function makeEngine(config: EdgeEngineConfig): LinUCBEngine {
  return new LinUCBEngine({
    dimensions: config.dimensions,
    alpha: config.alpha,
    actions: config.actions,
  });
}

function configMatches(
  state: SerializedEngineState,
  config: EdgeEngineConfig,
): boolean {
  return (
    state.dimensions === config.dimensions &&
    state.actions.length === config.actions.length &&
    state.actions.every((action, index) => action === config.actions[index])
  );
}

function restoreEngine(sessionId: string, config: EdgeEngineConfig): LinUCBEngine {
  const state = states.get(sessionId);

  if (state && configMatches(state, config)) {
    try {
      const restored = LinUCBEngine.deserialize(state);
      return restored.getAlpha() === config.alpha
        ? restored
        : restored.withAlpha(config.alpha);
    } catch {
      // Keep the scaffold live if a future serialized state is incompatible.
    }
  }

  const cached = engineFallbacks.get(sessionId);
  if (cached) {
    return cached.getAlpha() === config.alpha
      ? cached
      : cached.withAlpha(config.alpha);
  }

  return makeEngine(config);
}

function persistEngine(sessionId: string, engine: LinUCBEngine): void {
  engineFallbacks.set(sessionId, engine);

  try {
    states.set(sessionId, engine.serialize());
  } catch {
    states.delete(sessionId);
  }
}

function configFromRuntimeRequest(request: RuntimeRequest): EdgeEngineConfig {
  return {
    dimensions: request.dimensions,
    alpha: request.alpha,
    actions: request.actions,
  };
}

function pendingKey(sessionId: string, step: number): string {
  return sessionId + ":" + String(step);
}

export function createEdgeKvEmulator(): EdgeKvEmulator {
  return {
    async predict(request) {
      const startedAt = nowMs();
      const config = configFromRuntimeRequest(request);
      const engine = restoreEngine(request.sessionId, config);
      const prediction = engine.predictNextAction(request.contextVector);
      const predictedKey = deriveAssetKey(request.contextVector, prediction.action);
      const step = request.step ?? Date.now();

      pendingPredictions.set(pendingKey(request.sessionId, step), {
        sessionId: request.sessionId,
        step,
        key: predictedKey,
        action: prediction.action,
        contextVector: [...request.contextVector],
        prefetchedAt: Date.now(),
      });
      persistEngine(request.sessionId, engine);

      return {
        sessionId: request.sessionId,
        action: prediction.action,
        predictedKey,
        prefetch: {
          executed: false,
          key: predictedKey,
          originMs: null,
          cacheWritten: false,
        },
        ucbBreakdown: prediction.ucbBreakdown,
        computeMicros: computeMicros(startedAt),
      };
    },

    async update(request) {
      const startedAt = nowMs();
      const config = configFromRuntimeRequest(request);
      const engine = restoreEngine(request.sessionId, config);
      engine.updateWeights(
        request.action,
        request.contextVector,
        request.reward,
      );
      const prediction = engine.predictNextAction(request.contextVector);
      persistEngine(request.sessionId, engine);

      return {
        sessionId: request.sessionId,
        action: prediction.action,
        ucbBreakdown: prediction.ucbBreakdown,
        computeMicros: computeMicros(startedAt),
      };
    },

    async resolve(request) {
      const startedAt = nowMs();
      const engine = restoreEngine(request.sessionId, request.config);
      const step = request.step ?? Date.now();
      const pending = pendingPredictions.get(pendingKey(request.sessionId, step));
      const prediction = pending
        ? { action: pending.action, ucbBreakdown: engine.snapshot().lastUcb }
        : engine.predictNextAction(request.contextVector);
      const latencyMs = 100;
      const reward = rewardFromLatency(latencyMs, 5, 100);

      engine.updateWeights(prediction.action, request.contextVector, reward);
      const nextPrediction = engine.predictNextAction(request.contextVector);
      persistEngine(request.sessionId, engine);

      return {
        sessionId: request.sessionId,
        requestedKey: request.requestedKey,
        action: prediction.action,
        cacheHit: false,
        latencyMs,
        reward,
        ucbBreakdown: nextPrediction.ucbBreakdown,
        computeMicros: computeMicros(startedAt),
      };
    },

    async reset(sessionId) {
      states.delete(sessionId);
      engineFallbacks.delete(sessionId);
      for (const key of pendingPredictions.keys()) {
        if (key.startsWith(sessionId + ":")) pendingPredictions.delete(key);
      }
    },
  };
}

export const edgeKvEmulator = createEdgeKvEmulator();
