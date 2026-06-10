const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function assertFiniteVector(contextVector: number[]): void {
  if (!Array.isArray(contextVector) || contextVector.length === 0) {
    throw new Error("contextVector must be a non-empty array");
  }

  if (!contextVector.every(Number.isFinite)) {
    throw new Error("contextVector must contain only finite numbers");
  }
}

function normalizeAction(action: string): string {
  const normalized = action.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  if (normalized.length === 0) throw new Error("action must be a non-empty string");
  return normalized.slice(0, 48);
}

function fnv1a(input: string): string {
  let hash = FNV_OFFSET;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return hash.toString(36).padStart(7, "0");
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Derive the concrete asset key a prediction should prefetch.
 *
 * This minimal Phase 3 implementation is deterministic across runtimes and pure:
 * it quantizes the context vector, folds in the selected arm, then hashes with FNV-1a.
 */
export function deriveAssetKey(contextVector: number[], action: string): string {
  assertFiniteVector(contextVector);
  const normalizedAction = normalizeAction(action);
  const quantized = contextVector
    .map((value) => Math.round(value * 1000) / 1000)
    .map((value) => value.toFixed(3))
    .join(",");
  const hash = fnv1a(normalizedAction + "|" + quantized);
  return "asset/" + normalizedAction + "/" + hash;
}

/**
 * Convert measured resolve latency into a normalized reward.
 *
 * A cold miss at or above coldMs tends toward 0, while an edge hit at or below edgeMs tends toward 1.
 */
export function rewardFromLatency(
  measuredMs: number,
  edgeMs: number,
  coldMs: number,
): number {
  if (![measuredMs, edgeMs, coldMs].every(Number.isFinite)) return 0;
  if (coldMs <= edgeMs) return measuredMs <= edgeMs ? 1 : 0;
  return clamp01((coldMs - measuredMs) / (coldMs - edgeMs));
}
