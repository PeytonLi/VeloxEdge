export interface EmbeddingAdapter {
  embed(input: string, dimensions: number): Promise<number[]>;
}

export interface EmbeddingAdapterConfig {
  provider: "deterministic" | "external";
  model?: string;
  apiKey?: string;
}

function resize(vector: number[], dimensions: number): number[] {
  const resized = vector.slice(0, dimensions).map((value) =>
    Number.isFinite(value) ? value : 0,
  );
  while (resized.length < dimensions) resized.push(0);
  return resized;
}

export function createDeterministicEmbeddingAdapter(): EmbeddingAdapter {
  return {
    async embed(input, dimensions) {
      const values = Array.from({ length: Math.max(1, dimensions) }, (_, index) => {
        const code = input.charCodeAt(index % Math.max(1, input.length)) || 0;
        return Number((((code * (index + 3)) % 997) / 997).toFixed(6));
      });
      return resize(values, dimensions);
    },
  };
}

export function createEmbeddingAdapter(
  config: EmbeddingAdapterConfig = { provider: "deterministic" },
): EmbeddingAdapter {
  if (config.provider === "external") {
    // E3 wires provider-specific network calls behind VELOX_EMBEDDING_*.
    return createDeterministicEmbeddingAdapter();
  }

  return createDeterministicEmbeddingAdapter();
}
