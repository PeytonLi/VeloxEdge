import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = "text-embedding-004";

interface EmbedRequest {
  input: string;
  provider?: "gemini" | "openai" | "deterministic";
  dimensions?: number;
}

function deterministicEmbed(input: string, dimensions: number): number[] {
  return Array.from({ length: Math.max(1, dimensions) }, (_, i) => {
    const code = input.charCodeAt(i % Math.max(1, input.length)) || 0;
    return Number((((code * (i + 3)) % 997) / 997).toFixed(6));
  });
}

async function geminiEmbed(input: string, apiKey: string): Promise<number[]> {
  // Truncate to stay well within Gemini's 2048-token input limit
  const safeInput = input.length > 8000 ? input.slice(0, 8000) : input;

  const url = `${GEMINI_BASE}/models/${GEMINI_MODEL}:embedContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text: safeInput }] },
        outputDimensionality: 768,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `[VeloxEdge] Gemini embed ${response.status}:`,
      errorText.slice(0, 500),
    );
    throw new Error(
      `Gemini embedding failed (${response.status}): ${errorText.slice(0, 200)}`,
    );
  }

  const json = (await response.json()) as {
    embedding?: { values: number[] };
  };

  if (!json.embedding?.values?.length) {
    console.error("[VeloxEdge] Gemini embed: unexpected response shape", json);
    throw new Error("Gemini returned empty embedding");
  }

  return json.embedding.values;
}

async function openaiEmbed(
  input: string,
  apiKey: string,
  dimensions: number,
): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input,
      dimensions: Math.min(dimensions, 1536),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embedding failed (${response.status}): ${error}`);
  }

  const json = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  if (!json.data?.[0]?.embedding?.length) {
    throw new Error("OpenAI returned empty embedding");
  }

  return json.data[0].embedding;
}

function reduceDimensions(
  vector: number[],
  targetDimensions: number,
): number[] {
  if (vector.length <= targetDimensions) {
    return [...vector, ...new Array(targetDimensions - vector.length).fill(0)];
  }

  const result: number[] = [];
  const stride = Math.floor(vector.length / targetDimensions);

  for (let i = 0; i < targetDimensions; i++) {
    const start = i * stride;
    const end = i === targetDimensions - 1 ? vector.length : start + stride;
    let sum = 0;
    for (let j = start; j < end; j++) sum += vector[j];
    result.push(sum / (end - start));
  }

  return result;
}

export async function POST(request: NextRequest) {
  let body: EmbedRequest;
  try {
    body = (await request.json()) as EmbedRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = body.input?.trim();
  if (!input) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }

  const dimensions = Math.max(1, Math.floor(body.dimensions ?? 12));
  const provider = body.provider ?? "deterministic";

  try {
    let vector: number[];

    switch (provider) {
      case "gemini": {
        const apiKey = process.env.GEMINI_API_KEY?.trim();
        if (!apiKey) {
          return NextResponse.json(
            { error: "GEMINI_API_KEY is not configured" },
            { status: 500 },
          );
        }
        const full = await geminiEmbed(input, apiKey);
        vector = reduceDimensions(full, dimensions);
        break;
      }

      case "openai": {
        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) {
          return NextResponse.json(
            { error: "OPENAI_API_KEY is not configured" },
            { status: 500 },
          );
        }
        vector = await openaiEmbed(input, apiKey, dimensions);
        break;
      }

      default:
        vector = deterministicEmbed(input, dimensions);
    }

    return NextResponse.json({ vector, dimensions: vector.length, provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Embedding failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
