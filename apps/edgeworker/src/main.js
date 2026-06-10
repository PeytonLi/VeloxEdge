import { createResponse } from "create-response";
import { httpRequest } from "http-request";
import { logger } from "log";
import {
  LinUCBEngine,
  VELOX_ASSET_TTL_SECONDS,
  VELOX_EDGE_SECRET_HEADER,
  VELOX_PENDING_TTL_SECONDS,
  VELOX_STATE_TTL_SECONDS,
  deriveAssetKey,
  rewardFromLatency,
} from "@veloxedge/bandit-engine";
import { EdgeKV } from "./edgekv.js";
import { edgekv_access_tokens } from "./edgekv_tokens.js";

const JSON_HEADERS = {
  "content-type": ["application/json; charset=utf-8"],
  "cache-control": ["no-store"],
};

const EDGEKV_NAMESPACE = "veloxedge";
const STATE_GROUP = "sessions";
const ASSET_GROUP = "assets";
const PENDING_GROUP = "pending";
const EDGEKV_TIMEOUT_MS = 250;
const ORIGIN_TIMEOUT_MS = 3500;
const SESSION_PREFIX = "veloxedge_";
const ASSET_PREFIX = "asset_";
const PENDING_PREFIX = "pending_";
const EDGE_HIT_MS = 5;
const DEFAULT_COLD_ORIGIN_MS = 100;
const DEFAULT_ORIGIN_URL = "https://example.invalid/veloxedge-origin";
const DEFAULT_CONFIG = {
  dimensions: 12,
  alpha: 1,
  actions: ["TOOL_CONTEXT", "EDGEKV_MEMORY", "VECTOR_WEIGHTS", "NO_OP"],
};

function jsonResponse(status, payload) {
  return createResponse(status, JSON_HEADERS, JSON.stringify(payload));
}

function errorResponse(status, code, message, details = undefined) {
  return jsonResponse(status, {
    error: code,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

function logInfo(message, details = {}) {
  try {
    logger.log("VeloxEdge " + message + " " + JSON.stringify(details));
  } catch {
    // Logging must never break request handling.
  }
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function nowMicros() {
  return nowMs() * 1000;
}

function computeMicrosSince(startMicros) {
  return Math.max(0, Math.round(nowMicros() - startMicros));
}

function getPath(request) {
  if (typeof request?.path === "string") return request.path;
  if (typeof request?.url === "string") {
    try {
      return new URL(request.url).pathname;
    } catch {
      return request.url.split("?")[0] || "/";
    }
  }
  return "/";
}

function getMethod(request) {
  return String(request?.method ?? "GET").toUpperCase();
}

function headerValues(request, name) {
  const direct = request?.headers?.[name] ?? request?.headers?.[name.toLowerCase()];
  if (Array.isArray(direct)) return direct;
  if (typeof direct === "string") return [direct];

  if (typeof request?.getHeader === "function") {
    const value = request.getHeader(name) ?? request.getHeader(name.toLowerCase());
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return [value];
  }

  return [];
}

function edgeRuntimeEnv(name, fallback, request = null) {
  try {
    if (typeof EdgeWorker !== "undefined" && EdgeWorker?.environment?.[name]) {
      return String(EdgeWorker.environment[name]);
    }
  } catch {
    // Not present in local build/runtime.
  }

  try {
    if (request && typeof request.getVariable === "function") {
      const direct = request.getVariable(name);
      if (direct) return String(direct);
      const pmUser = request.getVariable("PMUSER_" + name);
      if (pmUser) return String(pmUser);
    }
  } catch {
    // Property Manager variables are optional.
  }

  try {
    if (typeof process !== "undefined" && process?.env?.[name]) {
      return String(process.env[name]);
    }
  } catch {
    // process is not present at Akamai edge runtime.
  }

  return fallback;
}

function assertAuthorized(request) {
  const expectedSecret = edgeRuntimeEnv("VELOX_EDGE_SECRET", "", request).trim();
  if (!expectedSecret) return;

  const received = headerValues(request, VELOX_EDGE_SECRET_HEADER)[0]?.trim();
  if (received !== expectedSecret) {
    throw Object.assign(new Error("Missing or invalid edge secret"), {
      status: 401,
      code: "unauthorized",
    });
  }
}

async function readJsonBody(request) {
  if (typeof request?.json === "function") return request.json();

  if (typeof request?.text === "function") {
    const text = await request.text();
    return text.length === 0 ? {} : JSON.parse(text);
  }

  if (typeof request?.body === "string") {
    return request.body.length === 0 ? {} : JSON.parse(request.body);
  }

  throw new Error("Request body is not readable as JSON");
}

function safeItem(prefix, rawValue) {
  const normalized = String(rawValue ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 440);

  if (normalized.length === 0) {
    throw new Error("EdgeKV item key cannot be empty");
  }

  return prefix + normalized;
}

function sessionItem(sessionId) {
  return safeItem(SESSION_PREFIX, sessionId);
}

function assetItem(assetKey) {
  return safeItem(ASSET_PREFIX, assetKey);
}

function pendingItem(sessionId, step) {
  return safeItem(PENDING_PREFIX, String(sessionId) + "_" + String(step));
}

function sanitizeConfig(payload) {
  const dimensions =
    Number.isInteger(payload?.dimensions) && payload.dimensions > 0
      ? payload.dimensions
      : DEFAULT_CONFIG.dimensions;
  const alpha =
    Number.isFinite(payload?.alpha) && payload.alpha >= 0
      ? payload.alpha
      : DEFAULT_CONFIG.alpha;
  const actions =
    Array.isArray(payload?.actions) && payload.actions.length > 0
      ? payload.actions.map(String)
      : DEFAULT_CONFIG.actions;

  return { dimensions, alpha, actions };
}

function assertContextVector(contextVector, dimensions) {
  if (!Array.isArray(contextVector) || contextVector.length !== dimensions) {
    throw new Error("contextVector must be an array with " + dimensions + " dimensions");
  }

  if (!contextVector.every(Number.isFinite)) {
    throw new Error("contextVector must contain only finite numbers");
  }
}

function assertReward(reward) {
  if (!Number.isFinite(reward) || reward < 0 || reward > 1) {
    throw new Error("reward must be a finite value in [0, 1]");
  }
}

function freshSerializedState(config) {
  return new LinUCBEngine(config).serialize();
}

function stateMatchesConfig(state, config) {
  return Boolean(
    state &&
      state.dimensions === config.dimensions &&
      Array.isArray(state.actions) &&
      state.actions.length === config.actions.length &&
      state.actions.every((action, index) => action === config.actions[index]),
  );
}

function restoreEngine(state, config) {
  const engine = LinUCBEngine.deserialize(state);
  return engine.getAlpha() === config.alpha ? engine : engine.withAlpha(config.alpha);
}

async function getEngineState(edgeKv, item, config) {
  const storedState = await edgeKv.getJson({
    group: STATE_GROUP,
    item,
    default_value: null,
    timeout: EDGEKV_TIMEOUT_MS,
  });

  return stateMatchesConfig(storedState, config) ? storedState : freshSerializedState(config);
}

async function putEngineState(edgeKv, item, state) {
  await edgeKv.putJson({
    group: STATE_GROUP,
    item,
    value: state,
    ttl: VELOX_STATE_TTL_SECONDS,
    timeout: EDGEKV_TIMEOUT_MS,
  });
}

function createEdgeKv(request) {
  return new EdgeKV({
    namespace: EDGEKV_NAMESPACE,
    group: STATE_GROUP,
    edgekv_access_tokens,
    ew_request: request,
  });
}

function matchesRoute(path, route) {
  return path === route || path.endsWith(route);
}

function assetUrl(key, request) {
  const baseUrl = edgeRuntimeEnv("VELOX_ORIGIN_URL", DEFAULT_ORIGIN_URL, request).replace(/\/+$/, "");
  return baseUrl + "/" + encodeURIComponent(key);
}

function responseHeader(response, name) {
  if (typeof response?.getHeader === "function") {
    const value = response.getHeader(name);
    if (Array.isArray(value)) return value[0];
    return value ?? null;
  }
  return null;
}

async function readOriginBody(response) {
  if (typeof response?.json === "function") {
    try {
      const json = await response.json();
      return {
        bytes: JSON.stringify(json),
        contentType: "application/json; charset=utf-8",
        coldOriginMs: Number(json?.coldOriginMs) || DEFAULT_COLD_ORIGIN_MS,
      };
    } catch {
      // Fall through to text body handling.
    }
  }

  const text = typeof response?.text === "function" ? await response.text() : "";
  return {
    bytes: text,
    contentType: responseHeader(response, "content-type") || "application/octet-stream",
    coldOriginMs: Number(responseHeader(response, "x-velox-cold-origin-ms")) || DEFAULT_COLD_ORIGIN_MS,
  };
}

async function fetchOriginAsset(key, request) {
  const startedAt = nowMs();
  const response = await httpRequest(assetUrl(key, request), {
    method: "GET",
    timeout: ORIGIN_TIMEOUT_MS,
    headers: { accept: ["application/json, text/plain, */*"] },
  });
  const originMs = Math.max(0, nowMs() - startedAt);

  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error("Origin fetch failed for " + key + " with status " + response?.status);
  }

  const body = await readOriginBody(response);
  return {
    key,
    bytes: body.bytes,
    contentType: body.contentType,
    coldOriginMs: Math.max(originMs, body.coldOriginMs),
    fetchedAt: Date.now(),
  };
}

async function putAsset(edgeKv, key, asset) {
  await edgeKv.putJson({
    group: ASSET_GROUP,
    item: assetItem(key),
    value: asset,
    ttl: VELOX_ASSET_TTL_SECONDS,
    timeout: EDGEKV_TIMEOUT_MS,
  });
}

async function prefetchAsset(edgeKv, key, request) {
  const startedAt = nowMs();

  try {
    const asset = await fetchOriginAsset(key, request);
    await putAsset(edgeKv, key, asset);
    return {
      executed: true,
      key,
      originMs: Math.max(0, nowMs() - startedAt),
      cacheWritten: true,
    };
  } catch (error) {
    logInfo("prefetch_failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      executed: true,
      key,
      originMs: Math.max(0, nowMs() - startedAt),
      cacheWritten: false,
    };
  }
}

async function putPending(edgeKv, pending) {
  await edgeKv.putJson({
    group: PENDING_GROUP,
    item: pendingItem(pending.sessionId, pending.step),
    value: pending,
    ttl: VELOX_PENDING_TTL_SECONDS,
    timeout: EDGEKV_TIMEOUT_MS,
  });
}

async function getPending(edgeKv, sessionId, step) {
  return edgeKv.getJson({
    group: PENDING_GROUP,
    item: pendingItem(sessionId, step),
    default_value: null,
    timeout: EDGEKV_TIMEOUT_MS,
  });
}

async function resolveAsset(edgeKv, requestedKey, request) {
  const startedAt = nowMs();
  const cached = await edgeKv.getJson({
    group: ASSET_GROUP,
    item: assetItem(requestedKey),
    default_value: null,
    timeout: EDGEKV_TIMEOUT_MS,
  });

  if (cached) {
    return {
      asset: cached,
      cacheHit: true,
      latencyMs: Math.max(EDGE_HIT_MS, nowMs() - startedAt),
    };
  }

  const asset = await fetchOriginAsset(requestedKey, request);
  await putAsset(edgeKv, requestedKey, asset);

  return {
    asset,
    cacheHit: false,
    latencyMs: Math.max(0, nowMs() - startedAt),
  };
}

function resolveStep(payload) {
  return Number.isInteger(payload?.step) ? payload.step : Date.now();
}

async function handlePredict(request, payload) {
  const startMicros = nowMicros();
  const config = sanitizeConfig(payload);
  assertContextVector(payload?.contextVector, config.dimensions);

  const sessionId = String(payload.sessionId ?? "");
  const step = resolveStep(payload);
  const item = sessionItem(sessionId);
  const edgeKv = createEdgeKv(request);
  const state = await getEngineState(edgeKv, item, config);
  const engine = restoreEngine(state, config);
  const prediction = engine.predictNextAction(payload.contextVector);
  const predictedKey = deriveAssetKey(payload.contextVector, prediction.action);
  const prefetch = await prefetchAsset(edgeKv, predictedKey, request);

  await putPending(edgeKv, {
    sessionId,
    step,
    key: predictedKey,
    action: prediction.action,
    contextVector: [...payload.contextVector],
    prefetchedAt: Date.now(),
  });

  logInfo("predict", {
    sessionId,
    step,
    action: prediction.action,
    predictedKey,
    cacheWritten: prefetch.cacheWritten,
  });

  return jsonResponse(200, {
    sessionId,
    action: prediction.action,
    predictedKey,
    prefetch,
    ucbBreakdown: prediction.ucbBreakdown,
    computeMicros: computeMicrosSince(startMicros),
  });
}

async function handleUpdate(request, payload) {
  const startMicros = nowMicros();
  const config = sanitizeConfig(payload);
  assertContextVector(payload?.contextVector, config.dimensions);
  assertReward(payload?.reward);

  const sessionId = String(payload.sessionId ?? "");
  const item = sessionItem(sessionId);
  const edgeKv = createEdgeKv(request);
  const state = await getEngineState(edgeKv, item, config);
  const engine = restoreEngine(state, config);

  engine.updateWeights(String(payload.action ?? ""), payload.contextVector, payload.reward);
  const prediction = engine.predictNextAction(payload.contextVector);
  await putEngineState(edgeKv, item, engine.serialize());

  return jsonResponse(200, {
    sessionId,
    action: prediction.action,
    ucbBreakdown: prediction.ucbBreakdown,
    computeMicros: computeMicrosSince(startMicros),
  });
}

async function handleResolve(request, payload) {
  const startMicros = nowMicros();
  const config = sanitizeConfig(payload?.config ?? payload);
  assertContextVector(payload?.contextVector, config.dimensions);

  const sessionId = String(payload.sessionId ?? "");
  const step = resolveStep(payload);
  const requestedKey = String(payload.requestedKey ?? "");
  if (!requestedKey) throw new Error("requestedKey is required");

  const item = sessionItem(sessionId);
  const edgeKv = createEdgeKv(request);
  const state = await getEngineState(edgeKv, item, config);
  const engine = restoreEngine(state, config);
  const pending = await getPending(edgeKv, sessionId, step);
  const resolved = await resolveAsset(edgeKv, requestedKey, request);
  const fallbackPrediction = pending ? null : engine.predictNextAction(payload.contextVector);
  const action = pending?.action ?? fallbackPrediction.action;
  const contextVector = Array.isArray(pending?.contextVector)
    ? pending.contextVector
    : payload.contextVector;
  const coldMs = Number(resolved.asset?.coldOriginMs) || DEFAULT_COLD_ORIGIN_MS;
  const reward = rewardFromLatency(resolved.latencyMs, EDGE_HIT_MS, coldMs);

  engine.updateWeights(action, contextVector, reward);
  const nextPrediction = engine.predictNextAction(contextVector);
  await putEngineState(edgeKv, item, engine.serialize());

  logInfo("resolve", {
    sessionId,
    step,
    requestedKey,
    action,
    cacheHit: resolved.cacheHit,
    latencyMs: resolved.latencyMs,
    reward,
  });

  return jsonResponse(200, {
    sessionId,
    requestedKey,
    action,
    cacheHit: resolved.cacheHit,
    latencyMs: resolved.latencyMs,
    reward,
    ucbBreakdown: nextPrediction.ucbBreakdown,
    computeMicros: computeMicrosSince(startMicros),
  });
}

async function handleReset(request, payload) {
  const startMicros = nowMicros();
  const config = sanitizeConfig(payload);
  const sessionId = String(payload.sessionId ?? "");
  const item = sessionItem(sessionId);
  const edgeKv = createEdgeKv(request);
  const engine = new LinUCBEngine(config);
  const prediction = engine.predictNextAction(new Array(config.dimensions).fill(0));

  await putEngineState(edgeKv, item, engine.serialize());

  return jsonResponse(200, {
    sessionId,
    action: prediction.action,
    ucbBreakdown: prediction.ucbBreakdown,
    computeMicros: computeMicrosSince(startMicros),
  });
}

export async function responseProvider(request) {
  const method = getMethod(request);
  const path = getPath(request);

  if (method === "GET" && matchesRoute(path, "/health")) {
    return jsonResponse(200, { ok: true, service: "veloxedge-edgeworker" });
  }

  if (method !== "POST") {
    return errorResponse(
      405,
      "method_not_allowed",
      "Use POST for /predict, /resolve, /update, or /reset",
    );
  }

  try {
    assertAuthorized(request);
    const payload = await readJsonBody(request);

    if (matchesRoute(path, "/predict")) return handlePredict(request, payload);
    if (matchesRoute(path, "/resolve")) return handleResolve(request, payload);
    if (matchesRoute(path, "/update")) return handleUpdate(request, payload);
    if (matchesRoute(path, "/reset")) return handleReset(request, payload);

    return errorResponse(404, "not_found", "Route not found: " + path);
  } catch (error) {
    const status = Number(error?.status) || 400;
    const code = typeof error?.code === "string" ? error.code : "bad_request";
    const message = error instanceof Error ? error.message : String(error);
    logInfo("request_failed", { path, status, code, message });
    return errorResponse(status, code, message);
  }
}
