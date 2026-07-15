import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { openrouterChat } from "../core/openrouter.ts";
import { buildMessages } from "../core/promptBuilder.ts";
import { config } from "../config.ts";
import type { ChatRequest, Usage } from "../../shared/types.ts";

export const chat = new Hono();

chat.post("/", async (c) => {
  const body = (await c.req.json()) as ChatRequest & {
    soul?: string | null; facts?: string[]; skillInstructions?: string[];
  };

  const messages = buildMessages({
    systemMode: body.systemMode ?? "append",
    system: body.system,
    soul: body.soul ?? null,
    facts: body.facts ?? [],
    skillInstructions: body.skillInstructions ?? [],
    messages: body.messages ?? [],
  });

  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    c.req.raw.signal?.addEventListener("abort", () => ac.abort());
    const send = (ev: unknown) => stream.writeSSE({ data: JSON.stringify(ev) });

    let res: Response;
    try {
      res = await openrouterChat({
        model: body.model,
        messages,
        temperature: body.temperature,
        signal: ac.signal,
      });
    } catch (e: any) {
      await send({ type: "error", message: String(e?.message ?? e) });
      return;
    }

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      await send({ type: "error", message: `OpenRouter ${res.status}: ${txt.slice(0, 300)}` });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let usageRaw: any = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const raw = t.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;

          let json: any;
          try { json = JSON.parse(raw); } catch { continue; }

          if (json.error) {
            await send({ type: "error", message: String(json.error?.message ?? "provider error") });
            continue;
          }
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) await send({ type: "token", text: delta });
          if (json.usage) usageRaw = json.usage; // final chunk (usage.include=true)
        }
      }
    } catch (e: any) {
      if (!ac.signal.aborted) await send({ type: "error", message: String(e?.message ?? e) });
    }

    if (usageRaw) {
      const promptTokens = usageRaw.prompt_tokens ?? 0;
      const cachedTokens = usageRaw.prompt_tokens_details?.cached_tokens ?? 0;
      const usage: Usage = {
        promptTokens,
        completionTokens: usageRaw.completion_tokens ?? 0,
        cachedTokens,
        cachedPct: promptTokens > 0 ? Math.round((cachedTokens / promptTokens) * 100) : 0,
        costUsd: usageRaw.cost ?? 0,
        provider: "openrouter",
        model: body.model,
      };
      await send({ type: "usage", usage });
    }

    await send({ type: "done" });
  });
});
