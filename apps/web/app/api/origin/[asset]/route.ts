import { NextRequest, NextResponse } from "next/server";
import { descriptorForAsset } from "@/lib/edge/assetCatalog";

export const runtime = "nodejs";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ asset: string }> },
) {
  const { asset } = await context.params;
  const descriptor = descriptorForAsset(asset);
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
