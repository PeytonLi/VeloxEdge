const ASSET_KEY_VERSION = "v1";
const MAX_ACTION_KEY_LENGTH = 48;

function assertFiniteVector(contextVector: number[]): void {
  if (!Array.isArray(contextVector) || contextVector.length === 0) {
    throw new Error("contextVector must be a non-empty array");
  }

  if (!contextVector.every(Number.isFinite)) {
    throw new Error("contextVector must contain only finite numbers");
  }
}

function normalizeAction(action: string): string {
  if (typeof action !== "string") {
    throw new Error("action must be a non-empty string");
  }

  const normalized = action
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (normalized.length === 0) {
    throw new Error("action must be a non-empty string");
  }

  return normalized.slice(0, MAX_ACTION_KEY_LENGTH);
}

function canonicalNumber(value: number): string {
  if (Object.is(value, -0) || value === 0) {
    return "0";
  }

  const text = value.toPrecision(15);
  const exponentIndex = text.indexOf("e");
  const mantissa = exponentIndex === -1 ? text : text.slice(0, exponentIndex);
  const exponent = exponentIndex === -1 ? "" : text.slice(exponentIndex);
  const trimmedMantissa = mantissa.includes(".")
    ? mantissa.replace(/0+$/, "").replace(/\.$/, "")
    : mantissa;

  return trimmedMantissa + exponent;
}

function canonicalContext(contextVector: number[]): string {
  return contextVector.map(canonicalNumber).join(",");
}

function hash128(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let h3 = 0xc0decafe;
  let h4 = 0x9e3779b9;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x85ebca6b);
    h2 = Math.imul(h2 ^ code, 0xc2b2ae35);
    h3 = Math.imul(h3 ^ code, 0x27d4eb2f);
    h4 = Math.imul(h4 ^ code, 0x165667b1);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x85ebca6b);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 0x27d4eb2f);
  h4 = Math.imul(h4 ^ (h4 >>> 13), 0x165667b1);

  return [h1, h2, h3, h4]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Derive the concrete asset key a prediction should prefetch.
 *
 * The key format is intentionally URL-safe and runtime-portable:
 *   asset/v1/<normalized-action>/d<dimensions>/<128-bit-hex-hash>
 *
 * The context is canonicalized, not rounded, so nearby embeddings remain distinguishable while
 * equivalent JS numbers (notably -0 and 0) map to the same asset.
 */
export function deriveAssetKey(
  contextVector: number[],
  action: string,
): string {
  assertFiniteVector(contextVector);
  const normalizedAction = normalizeAction(action);
  const payload = [
    ASSET_KEY_VERSION,
    normalizedAction,
    "d" + contextVector.length,
    canonicalContext(contextVector),
  ].join("|");
  const hash = hash128(payload);

  return [
    "asset",
    ASSET_KEY_VERSION,
    normalizedAction,
    "d" + contextVector.length,
    hash,
  ].join("/");
}

/**
 * Convert measured resolve latency into a normalized reward.
 *
 * A cold miss at or above coldMs maps to 0, while an edge hit at or below edgeMs maps to 1.
 * Invalid bounds return 0 rather than manufacturing reward from ambiguous measurements.
 */
export function rewardFromLatency(
  measuredMs: number,
  edgeMs: number,
  coldMs: number,
): number {
  if (![measuredMs, edgeMs, coldMs].every(Number.isFinite)) {
    return 0;
  }

  if (edgeMs < 0 || coldMs <= edgeMs) {
    return 0;
  }

  return clamp01((coldMs - measuredMs) / (coldMs - edgeMs));
}
