import { config } from "../config.ts";

export interface ChatParams {
  model: string;
  messages: { role: string; content: unknown }[];
  temperature?: number;
  signal?: AbortSignal;
}

const headers = () => ({
  "Authorization": `Bearer ${config.openrouter.apiKey}`,
  "Content-Type": "application/json",
  "HTTP-Referer": config.openrouter.siteUrl,
  "X-Title": config.openrouter.appTitle,
});

export async function openrouterChat(p: ChatParams): Promise<Response> {
  return fetch(`${config.openrouter.baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(),
    signal: p.signal,
    body: JSON.stringify({
      model: p.model,
      messages: p.messages,
      temperature: p.temperature ?? 0.7,
      stream: true,
      usage: { include: true },
    }),
  });
}

export async function listModels(): Promise<unknown> {
  const r = await fetch(`${config.openrouter.baseUrl}/models`, { headers: headers() });
  if (!r.ok) throw new Error(`models ${r.status}`);
  return r.json();
}
