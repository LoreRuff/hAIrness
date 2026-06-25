import { config } from "../config.ts";

export interface ChatParams {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  stream: boolean;
  signal?: AbortSignal;
}

const HEADERS = () => ({
  "Authorization": `Bearer ${config.openrouter.apiKey}`,
  "Content-Type": "application/json",
  "HTTP-Referer": config.openrouter.siteUrl,
  "X-Title": config.openrouter.appTitle,
});

/** Returns the raw fetch Response (streaming SSE body when stream=true). */
export async function openrouterChat(p: ChatParams): Promise<Response> {
  return fetch(`${config.openrouter.baseUrl}/chat/completions`, {
    method: "POST",
    headers: HEADERS(),
    signal: p.signal,
    body: JSON.stringify({
      model: p.model,
      messages: p.messages,
      temperature: p.temperature ?? 0.7,
      stream: p.stream,
      usage: { include: true }, // ask OpenRouter to include usage in stream
    }),
  });
}

export async function listModels(): Promise<unknown> {
  const r = await fetch(`${config.openrouter.baseUrl}/models`, { headers: HEADERS() });
  if (!r.ok) throw new Error(`models ${r.status}`);
  return r.json();
}
