export interface EmbeddingAdapter {
  embed(input: string, dimensions: number): Promise<number[]>;
}

export type EmbeddingProvider = "deterministic" | "gemini" | "openai";

function resolveProvider(): EmbeddingProvider {
  if (typeof window === "undefined") return "deterministic";
  const configured = (process.env.NEXT_PUBLIC_VELOX_EMBEDDING_PROVIDER ?? "")
    .trim()
    .toLowerCase();
  if (configured === "gemini" || configured === "openai") return configured;
  return "deterministic";
}

function resize(vector: number[], dimensions: number): number[] {
  const resized = vector
    .slice(0, dimensions)
    .map((value) => (Number.isFinite(value) ? value : 0));
  while (resized.length < dimensions) resized.push(0);
  return resized;
}

function deterministicEmbed(input: string, dimensions: number): number[] {
  const values = Array.from({ length: Math.max(1, dimensions) }, (_, index) => {
    const code = input.charCodeAt(index % Math.max(1, input.length)) || 0;
    return Number((((code * (index + 3)) % 997) / 997).toFixed(6));
  });
  return resize(values, dimensions);
}

async function remoteEmbed(
  input: string,
  dimensions: number,
  provider: EmbeddingProvider,
): Promise<number[]> {
  const response = await fetch("/api/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, dimensions, provider }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ??
        `Embed API returned ${response.status}`,
    );
  }

  const json = (await response.json()) as { vector: number[] };
  return resize(json.vector, dimensions);
}

/**
 * Create an embedding adapter that reads NEXT_PUBLIC_VELOX_EMBEDDING_PROVIDER
 * from the environment. When set to "gemini" or "openai", embeddings are
 * produced by calling the server-side /api/embed route (which holds the API
 * key securely). Falls back to deterministic hashing otherwise.
 */
export function createEmbeddingAdapter(): EmbeddingAdapter {
  const provider = resolveProvider();

  return {
    async embed(input, dimensions) {
      if (provider === "deterministic") {
        return deterministicEmbed(input, dimensions);
      }
      return remoteEmbed(input, dimensions, provider);
    },
  };
}
