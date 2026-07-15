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
export async function openrouterComplete(p: {
  model: string;
  messages: { role: string; content: unknown }[];
  temperature?: number;
}): Promise<{ text: string; usageRaw: unknown }> {
  const r = await fetch(`${config.openrouter.baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: p.model,
      messages: p.messages,
      temperature: p.temperature ?? 0.7,
      stream: false,
      usage: { include: true },
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const j: any = await r.json();
  return { text: j.choices?.[0]?.message?.content ?? "", usageRaw: j.usage };
}

