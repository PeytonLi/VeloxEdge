import { NextRequest, NextResponse } from "next/server";
import type { AssetDescriptor } from "@veloxedge/bandit-engine";

export const runtime = "nodejs";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function descriptorFor(asset: string): AssetDescriptor {
  const key = decodeURIComponent(asset);
  return {
    key,
    bytes: JSON.stringify({ key, payload: "veloxedge-origin-asset", generatedAt: 0 }),
    coldOriginMs: 120,
    contentType: "application/json; charset=utf-8",
  };
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ asset: string }> },
) {
  const { asset } = await context.params;
  const descriptor = descriptorFor(asset);
  await sleep(descriptor.coldOriginMs);

  return new NextResponse(descriptor.bytes ?? "", {
    headers: {
      "content-type": descriptor.contentType ?? "application/octet-stream",
      "cache-control": "no-store",
      "x-velox-asset-key": descriptor.key,
      "x-velox-cold-origin-ms": String(descriptor.coldOriginMs),
    },
  });
}
