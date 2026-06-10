import type {
  EdgePredictRequest,
  EdgePredictResponse,
  EdgeUpdateRequest,
  EdgeUpdateResponse,
} from "@veloxedge/bandit-engine";

export type EdgeClientResponse<T> = T & {
  /** Browser-measured round-trip time for the Next.js edge API route. */
  rttMs: number;
};

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (payload && typeof payload.error === "string") return payload.error;
  } catch {
    // Fall through to status text.
  }

  return response.statusText || "Unknown edge API failure";
}

async function postJson<TRequest, TResponse extends object>(
  pathname: string,
  request: TRequest,
): Promise<EdgeClientResponse<TResponse>> {
  const startedAt = nowMs();
  const response = await fetch(pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const rttMs = Math.max(0, nowMs() - startedAt);

  if (!response.ok) {
    const message = await parseError(response);
    throw new Error(
      "VeloxEdge edge request failed (" + String(response.status) + "): " + message,
    );
  }

  const payload = (await response.json()) as TResponse;
  return { ...payload, rttMs } as EdgeClientResponse<TResponse>;
}

export async function predict(
  request: EdgePredictRequest,
): Promise<EdgeClientResponse<EdgePredictResponse>> {
  return postJson<EdgePredictRequest, EdgePredictResponse>(
    "/api/edge/predict",
    request,
  );
}

export async function update(
  request: EdgeUpdateRequest,
): Promise<EdgeClientResponse<EdgeUpdateResponse>> {
  return postJson<EdgeUpdateRequest, EdgeUpdateResponse>(
    "/api/edge/update",
    request,
  );
}

export const edgeClient = {
  predict,
  update,
};
