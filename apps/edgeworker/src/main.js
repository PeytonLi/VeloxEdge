import { createResponse } from "create-response";
import { LinUCBEngine } from "@veloxedge/bandit-engine";
import { EdgeKV } from "./edgekv.js";
import { edgekv_access_tokens } from "./edgekv_tokens.js";

const JSON_HEADERS = {
  "content-type": ["application/json; charset=utf-8"],
  "cache-control": ["no-store"],
};

const EDGEKV_NAMESPACE = "veloxedge";
const EDGEKV_GROUP = "sessions";
const EDGEKV_TIMEOUT_MS = 250;
const SESSION_PREFIX = "veloxedge_";
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

function nowMicros() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now() * 1000;
  }

  return Date.now() * 1000;
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

async function readJsonBody(request) {
  if (typeof request?.json === "function") {
    return request.json();
  }

  if (typeof request?.text === "function") {
    const text = await request.text();
    return text.length === 0 ? {} : JSON.parse(text);
  }

  if (typeof request?.body === "string") {
    return request.body.length === 0 ? {} : JSON.parse(request.body);
  }

  throw new Error("Request body is not readable as JSON");
}

function sanitizeSessionId(sessionId) {
  const normalized = String(sessionId ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(normalized)) {
    throw new Error("sessionId must be 1-180 characters using A-Z, a-z, 0-9, _ or -");
  }

  return SESSION_PREFIX + normalized;
}

function sanitizeConfig(payload) {
  const dimensions = Number.isInteger(payload?.dimensions) && payload.dimensions > 0
    ? payload.dimensions
    : DEFAULT_CONFIG.dimensions;
  const alpha = Number.isFinite(payload?.alpha) && payload.alpha >= 0
    ? payload.alpha
    : DEFAULT_CONFIG.alpha;
  const actions = Array.isArray(payload?.actions) && payload.actions.length > 0
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

async function getEngineState(edgeKv, item, config) {
  const storedState = await edgeKv.getJson({
    item,
    default_value: null,
    timeout: EDGEKV_TIMEOUT_MS,
  });

  return storedState ?? freshSerializedState(config);
}

async function putEngineState(edgeKv, item, state) {
  await edgeKv.putJson({
    item,
    value: state,
    timeout: EDGEKV_TIMEOUT_MS,
  });
}

function createEdgeKv(request) {
  return new EdgeKV({
    namespace: EDGEKV_NAMESPACE,
    group: EDGEKV_GROUP,
    edgekv_access_tokens,
    ew_request: request,
  });
}

function matchesRoute(path, route) {
  return path === route || path.endsWith(route);
}

async function handlePredict(request, payload) {
  const startMicros = nowMicros();
  const config = sanitizeConfig(payload);
  assertContextVector(payload?.contextVector, config.dimensions);

  const sessionId = String(payload.sessionId ?? "");
  const item = sanitizeSessionId(sessionId);
  const edgeKv = createEdgeKv(request);
  const state = await getEngineState(edgeKv, item, config);
  const engine = LinUCBEngine.deserialize(state);
  const prediction = engine.predictNextAction(payload.contextVector);

  await putEngineState(edgeKv, item, engine.serialize());

  return jsonResponse(200, {
    sessionId,
    action: prediction.action,
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
  const item = sanitizeSessionId(sessionId);
  const edgeKv = createEdgeKv(request);
  const state = await getEngineState(edgeKv, item, config);
  const engine = LinUCBEngine.deserialize(state);

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

async function handleReset(request, payload) {
  const startMicros = nowMicros();
  const config = sanitizeConfig(payload);
  const sessionId = String(payload.sessionId ?? "");
  const item = sanitizeSessionId(sessionId);
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
    return errorResponse(405, "method_not_allowed", "Use POST for /predict, /update, or /reset");
  }

  try {
    const payload = await readJsonBody(request);

    if (matchesRoute(path, "/predict")) return handlePredict(request, payload);
    if (matchesRoute(path, "/update")) return handleUpdate(request, payload);
    if (matchesRoute(path, "/reset")) return handleReset(request, payload);

    return errorResponse(404, "not_found", "Route not found: " + path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(400, "bad_request", message);
  }
}
