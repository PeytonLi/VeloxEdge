import type { AssetDescriptor } from "@veloxedge/bandit-engine";

const DEFAULT_COLD_ORIGIN_MS = 120;

function stableLatency(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return DEFAULT_COLD_ORIGIN_MS + (hash % 95);
}

export function descriptorForAsset(key: string): AssetDescriptor {
  const normalizedKey = decodeURIComponent(key).replace(/^\/+/, "");
  const coldOriginMs = stableLatency(normalizedKey);
  return {
    key: normalizedKey,
    bytes: JSON.stringify({
      key: normalizedKey,
      payload: "veloxedge-origin-asset",
      coldOriginMs,
      issuedBy: "mock-origin",
    }),
    coldOriginMs,
    contentType: "application/json; charset=utf-8",
  };
}

export function originBaseUrl(): string {
  const configured = process.env.VELOX_ORIGIN_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return "https://" + vercelUrl.replace(/\/$/, "");

  return "http://localhost:3000";
}

export function originUrlForAsset(key: string): string {
  return originBaseUrl() + "/api/origin/" + encodeURIComponent(key);
}

export function coldOriginMsFromHeaders(headers: Headers, fallbackKey: string): number {
  const header = headers.get("x-velox-cold-origin-ms");
  const parsed = header === null ? NaN : Number(header);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : descriptorForAsset(fallbackKey).coldOriginMs;
}
