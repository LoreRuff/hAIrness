import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { openrouterChat } from "../core/openrouter.ts";
import { buildMessages } from "../core/promptBuilder.ts";
import type { ChatRequest } from "../../shared/types.ts";

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

    let res: Response;
    try {
      res = await openrouterChat({
        model: body.model,
        messages,
        temperature: body.temperature,
        signal: ac.signal,
      });
    } catch (e: any) {
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message: String(e?.message ?? e) }) });
      return;
    }

    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      await stream.writeSSE({ data: JSON.stringify({ type: "error", message: `OpenRouter ${res.status}: ${txt.slice(0, 300)}` }) });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let usageRaw: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const t = line.trim();
        if
