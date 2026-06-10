import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface ChatRequest {
  prompt: string;
  provider?: "deepseek" | "openai";
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const DEEPSEEK_BASE = "https://api.deepseek.com/v1";
const OPENAI_BASE = "https://api.openai.com/v1";

const SYSTEM_PROMPT =
  "You are an autonomous AI agent executing a multi-step workflow. " +
  "Respond with what specific tools, data sources, or memory context " +
  "you would need to fetch next to answer the user's request. " +
  "Be concise — one paragraph max. Mention concrete assets like " +
  "database schemas, vector indexes, API specs, or model configs.";

function buildMessages(prompt: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];
}

async function chatCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Chat API failed (${response.status}): ${error.slice(0, 300)}`,
    );
  }

  const json = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Chat API returned empty response");

  return content;
}

export async function POST(request: NextRequest) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  const provider = body.provider ?? "deepseek";

  try {
    let response: string;

    switch (provider) {
      case "deepseek": {
        const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
        if (!apiKey) {
          return NextResponse.json(
            { error: "DEEPSEEK_API_KEY is not configured" },
            { status: 500 },
          );
        }
        const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
        response = await chatCompletion(
          DEEPSEEK_BASE,
          apiKey,
          model,
          buildMessages(prompt),
          400,
        );
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
        const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
        response = await chatCompletion(
          OPENAI_BASE,
          apiKey,
          model,
          buildMessages(prompt),
          400,
        );
        break;
      }

      default:
        return NextResponse.json(
          { error: `Unknown provider: ${provider}` },
          { status: 400 },
        );
    }

    return NextResponse.json({ response, provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
