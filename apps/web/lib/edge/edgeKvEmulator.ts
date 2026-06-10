import {
  LinUCBEngine,
  VELOX_ASSET_TTL_SECONDS,
  VELOX_PENDING_TTL_SECONDS,
  VELOX_STATE_TTL_SECONDS,
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
import { coldOriginMsFromHeaders, descriptorForAsset, originUrlForAsset } from "./assetCatalog";

export interface EdgeKvEmulator {
  predict(request: EdgePredictRequest): Promise<EdgePredictResponse>;
  update(request: EdgeUpdateRequest): Promise<EdgeUpdateResponse>;
  resolve(request: EdgeResolveRequest): Promise<EdgeResolveResponse>;
  reset(sessionId: string): Promise<void>;
}

type RuntimeRequest = EdgePredictRequest | EdgeUpdateRequest;

interface TtlItem<T> { value: T; expiresAt: number; }
interface CachedAsset { key: string; bytes: string; contentType: string; coldOriginMs: number; writtenAt: number; }
interface OriginFetchResult extends CachedAsset { originMs: number; }

const EDGE_HIT_MS = 5;
const states = new Map<string, TtlItem<SerializedEngineState>>();
const engineFallbacks = new Map<string, TtlItem<LinUCBEngine>>();
const pendingPredictions = new Map<string, TtlItem<PendingPrediction>>();
const assets = new Map<string, TtlItem<CachedAsset>>();

function nowMs(): number { return typeof performance === "undefined" ? Date.now() : performance.now(); }
function wallNow(): number { return Date.now(); }
function ttlExpires(seconds: number): number { return wallNow() + Math.max(1, seconds) * 1000; }
function computeMicros(startedAt: number): number { return Math.max(0, Math.round((nowMs() - startedAt) * 1000)); }
function measuredMs(startedAt: number): number { return Math.max(0, Math.round((nowMs() - startedAt) * 100) / 100); }
function ttlGet<T>(map: Map<string, TtlItem<T>>, key: string): T | null { const item = map.get(key); if (!item) return null; if (item.expiresAt <= wallNow()) { map.delete(key); return null; } return item.value; }
function ttlSet<T>(map: Map<string, TtlItem<T>>, key: string, value: T, seconds: number): void { map.set(key, { value, expiresAt: ttlExpires(seconds) }); }
function pendingKey(sessionId: string, step: number): string { return sessionId + ":" + String(step); }

function makeEngine(config: EdgeEngineConfig): LinUCBEngine {
  return new LinUCBEngine({ dimensions: config.dimensions, alpha: config.alpha, actions: config.actions });
}

function configMatches(state: SerializedEngineState, config: EdgeEngineConfig): boolean {
  return state.dimensions === config.dimensions && state.actions.length === config.actions.length && state.actions.every((action, index) => action === config.actions[index]);
}

function restoreEngine(sessionId: string, config: EdgeEngineConfig): LinUCBEngine {
  const state = ttlGet(states, sessionId);
  if (state && configMatches(state, config)) {
    try {
      const restored = LinUCBEngine.deserialize(state);
      return restored.getAlpha() === config.alpha ? restored : restored.withAlpha(config.alpha);
    } catch {
      // Fall through to in-memory engine fallback.
    }
  }

  const cached = ttlGet(engineFallbacks, sessionId);
  if (cached) return cached.getAlpha() === config.alpha ? cached : cached.withAlpha(config.alpha);
  return makeEngine(config);
}

function persistEngine(sessionId: string, engine: LinUCBEngine): void {
  ttlSet(engineFallbacks, sessionId, engine, VELOX_STATE_TTL_SECONDS);
  try { ttlSet(states, sessionId, engine.serialize(), VELOX_STATE_TTL_SECONDS); } catch { states.delete(sessionId); }
}

function configFromRuntimeRequest(request: RuntimeRequest): EdgeEngineConfig {
  return { dimensions: request.dimensions, alpha: request.alpha, actions: request.actions };
}

async function fetchOriginAsset(key: string): Promise<OriginFetchResult> {
  const startedAt = nowMs();
  const url = originUrlForAsset(key);
  try {
    const response = await fetch(url, { cache: "no-store" });
    const bytes = await response.text();
    if (!response.ok) throw new Error("origin returned " + String(response.status));
    return {
      key,
      bytes,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      coldOriginMs: coldOriginMsFromHeaders(response.headers, key),
      writtenAt: wallNow(),
      originMs: measuredMs(startedAt),
    };
  } catch {
    // If the app is being exercised without a running Next origin, keep the
    // emulator deterministic but still model a real cold asset fetch using the
    // same catalog data the origin route serves.
    const descriptor = descriptorForAsset(key);
    const started = nowMs();
    await new Promise((resolve) => setTimeout(resolve, descriptor.coldOriginMs));
    return {
      key,
      bytes: descriptor.bytes ?? "",
      contentType: descriptor.contentType ?? "application/octet-stream",
      coldOriginMs: descriptor.coldOriginMs,
      writtenAt: wallNow(),
      originMs: measuredMs(started) || measuredMs(startedAt),
    };
  }
}

async function prefetchAsset(key: string): Promise<{ originMs: number; cacheWritten: boolean }> {
  const fetched = await fetchOriginAsset(key);
  ttlSet(assets, key, fetched, VELOX_ASSET_TTL_SECONDS);
  return { originMs: fetched.originMs, cacheWritten: true };
}

async function resolveAsset(key: string): Promise<{ cacheHit: boolean; latencyMs: number; coldOriginMs: number }> {
  const startedAt = nowMs();
  const cached = ttlGet(assets, key);
  if (cached) {
    // Model edge-local read overhead while still basing reward on measured latency.
    await new Promise((resolve) => setTimeout(resolve, EDGE_HIT_MS));
    return { cacheHit: true, latencyMs: measuredMs(startedAt), coldOriginMs: cached.coldOriginMs };
  }

  const fetched = await fetchOriginAsset(key);
  ttlSet(assets, key, fetched, VELOX_ASSET_TTL_SECONDS);
  return { cacheHit: false, latencyMs: measuredMs(startedAt), coldOriginMs: fetched.coldOriginMs };
}

function predictionStep(requestStep: number | undefined): number {
  return typeof requestStep === "number" && Number.isFinite(requestStep) ? requestStep : wallNow();
}

export function createEdgeKvEmulator(): EdgeKvEmulator {
  return {
    async predict(request) {
      const startedAt = nowMs();
      const config = configFromRuntimeRequest(request);
      const engine = restoreEngine(request.sessionId, config);
      const prediction = engine.predictNextAction(request.contextVector);
      const predictedKey = deriveAssetKey(request.contextVector, prediction.action);
      const step = predictionStep(request.step);
      const prefetch = await prefetchAsset(predictedKey);

      ttlSet(
        pendingPredictions,
        pendingKey(request.sessionId, step),
        {
          sessionId: request.sessionId,
          step,
          key: predictedKey,
          action: prediction.action,
          contextVector: [...request.contextVector],
          prefetchedAt: wallNow(),
        },
        VELOX_PENDING_TTL_SECONDS,
      );

      // Predict is intentionally read-only with respect to bandit A/b state.
      return {
        sessionId: request.sessionId,
        action: prediction.action,
        predictedKey,
        prefetch: {
          executed: true,
          key: predictedKey,
          originMs: prefetch.originMs,
          cacheWritten: prefetch.cacheWritten,
        },
        ucbBreakdown: prediction.ucbBreakdown,
        computeMicros: computeMicros(startedAt),
      };
    },

    async update(request) {
      const startedAt = nowMs();
      const config = configFromRuntimeRequest(request);
      const engine = restoreEngine(request.sessionId, config);
      engine.updateWeights(request.action, request.contextVector, request.reward);
      const prediction = engine.predictNextAction(request.contextVector);
      persistEngine(request.sessionId, engine);
      return { sessionId: request.sessionId, action: prediction.action, ucbBreakdown: prediction.ucbBreakdown, computeMicros: computeMicros(startedAt) };
    },

    async resolve(request) {
      const startedAt = nowMs();
      const step = predictionStep(request.step);
      const pending = ttlGet(pendingPredictions, pendingKey(request.sessionId, step));
      const engine = restoreEngine(request.sessionId, request.config);
      const prediction = pending
        ? { action: pending.action, contextVector: pending.contextVector }
        : { action: engine.predictNextAction(request.contextVector).action, contextVector: request.contextVector };
      const assetResult = await resolveAsset(request.requestedKey);
      const reward = rewardFromLatency(assetResult.latencyMs, EDGE_HIT_MS, assetResult.coldOriginMs);

      engine.updateWeights(prediction.action, prediction.contextVector, reward);
      const nextPrediction = engine.predictNextAction(request.contextVector);
      persistEngine(request.sessionId, engine);
      pendingPredictions.delete(pendingKey(request.sessionId, step));

      return {
        sessionId: request.sessionId,
        requestedKey: request.requestedKey,
        action: prediction.action,
        cacheHit: assetResult.cacheHit,
        latencyMs: assetResult.latencyMs,
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
