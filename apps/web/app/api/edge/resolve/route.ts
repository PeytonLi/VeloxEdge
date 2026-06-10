import { NextRequest, NextResponse } from "next/server";
import {
  VELOX_EDGE_SECRET_HEADER,
  type EdgeResolveRequest,
} from "@veloxedge/bandit-engine";
import { edgeKvEmulator } from "@/lib/edge/edgeKvEmulator";

export const runtime = "nodejs";

function edgeworkerEndpoint(pathname: string): string | null {
  const baseUrl = process.env.VELOX_EDGEWORKER_URL?.trim();
  if (!baseUrl) return null;
  return baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1) + pathname
    : baseUrl + pathname;
}

function proxyHeaders(): HeadersInit {
  const secret = process.env.VELOX_EDGE_SECRET?.trim();
  return {
    "content-type": "application/json",
    ...(secret ? { [VELOX_EDGE_SECRET_HEADER]: secret } : {}),
  };
}

async function proxyToEdgeworker(
  endpoint: string,
  payload: EdgeResolveRequest,
): Promise<NextResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: proxyHeaders(),
    body: JSON.stringify(payload),
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = { error: "EdgeWorker returned a non-JSON response" };
  }

  return NextResponse.json(body, { status: response.status });
}

export async function POST(request: NextRequest) {
  let payload: EdgeResolveRequest;

  try {
    payload = (await request.json()) as EdgeResolveRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const endpoint = edgeworkerEndpoint("/resolve");
  if (endpoint) return proxyToEdgeworker(endpoint, payload);

  try {
    const response = await edgeKvEmulator.resolve(payload);
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown emulator failure";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
