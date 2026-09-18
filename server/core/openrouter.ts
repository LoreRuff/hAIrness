import { config } from "../config.ts";

export interface ChatParams {
  model: string;
  messages: { role: string; content: unknown }[];
  temperature?: number;
  reasoning?: string; // effort hint: low | medium | high; omitted when unset
  tools?: unknown[]; // OpenAI function-calling specs; omitted when empty
  signal?: AbortSignal;
}

const headers = () => ({
  "Authorization": `Bearer ${config.openrouter.apiKey}`,
  "Content-Type": "application/json",
  "HTTP-Referer": config.openrouter.siteUrl,
  "X-Title": config.openrouter.appTitle,
});

// MAX_TOKENS_PER_RUN caps the generation size of every provider call (the only
// enforceable per-run ceiling: prompt size is known only after the fact).
// 0 = disabled, no max_tokens field so model defaults are preserved.
function runCeiling() {
  return config.budget.maxTokensPerRun > 0 ? { max_tokens: config.budget.maxTokensPerRun } : {};
}

export async function openrouterChat(p: ChatParams): Promise<Response> {
  return fetch(`${config.openrouter.baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(),
    signal: p.signal,
    body: JSON.stringify({
      model: p.model,
      messages: p.messages,
      temperature: p.temperature ?? 0.7,
      ...(p.reasoning ? { reasoning: { effort: p.reasoning } } : {}),
      stream: true,
      usage: { include: true },
      ...runCeiling(),
      ...(p.tools?.length ? { tools: p.tools, tool_choice: "auto" } : {}),
    }),
  });
}

export async function listModels(): Promise<unknown> {
  const r = await fetch(`${config.openrouter.baseUrl}/models`, { headers: headers() });
  if (!r.ok) throw new Error(`models ${r.status}`);
  return r.json();
}

function extractText(msg: any): string {
  const c = msg?.content;
  if (typeof c === "string" && c.trim()) return c;
  if (Array.isArray(c)) {
    const joined = c
      .map((p: any) => (typeof p === "string" ? p : p?.text ?? ""))
      .join("");
    if (joined.trim()) return joined;
  }
  if (typeof msg?.reasoning === "string" && msg.reasoning.trim()) return msg.reasoning;
  if (typeof msg?.reasoning_content === "string" && msg.reasoning_content.trim()) return msg.reasoning_content;
  return "";
}

export async function openrouterComplete(p: {
  model: string;
  messages: { role: string; content: unknown }[];
  temperature?: number;
  reasoning?: string; // effort hint (graph nodes): omitted when unset
}): Promise<{ text: string; usageRaw: unknown }> {
  const r = await fetch(`${config.openrouter.baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: p.model,
      messages: p.messages,
      temperature: p.temperature ?? 0.7,
      ...(p.reasoning ? { reasoning: { effort: p.reasoning } } : {}),
      stream: false,
      usage: { include: true },
      ...runCeiling(),
    }),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const j: any = await r.json();
  const choice = j.choices?.[0];
  let text = extractText(choice?.message);
  if (!text.trim()) {
    text = `[empty output from ${p.model}]\nfinish_reason: ${choice?.finish_reason ?? "?"}\nraw message: ${JSON.stringify(choice?.message ?? j).slice(0, 800)}`;
  }
  return { text, usageRaw: j.usage };
}
