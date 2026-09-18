import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { openrouterChat, openrouterComplete } from "../core/openrouter.ts";
import { buildMessages } from "../core/promptBuilder.ts";
import { availableTools, applyToolCallDelta, runTool, toolSpecs, type ToolCallAccum } from "../core/tools.ts";
import { sliceContext } from "../core/context.ts";
import { createTask, finishTask, logToolEvent } from "../db.ts";
import { checkTokenBudget, budgetMessage } from "../core/budget.ts";
import type { Env } from "../core/auth.ts";
import { config } from "../config.ts";
import type { ChatMessage, ChatRequest, ToolCall, Usage } from "../../shared/types.ts";

export const chat = new Hono<Env>();

// Cap the agentic loop: a runaway model must not bill unbounded tool rounds.
const MAX_TOOL_ROUNDS = 4;
// Tool payloads go back into the model context; a huge page would blow it.
const TOOL_RESULT_MAX_CHARS = 8000;
// Rolling summary cache: same dropped set → same summary, so continuing a long
// chat doesn't re-summarize on every turn. Keyed by the exact message id span.
const summaryCache = new Map<string, string>();

chat.post("/", async (c) => {
  const body = (await c.req.json()) as ChatRequest & {
    soul?: string | null; facts?: string[]; skillInstructions?: string[]; promptInstructions?: string[];
  };

  // H4: quota gate before anything is billed (owner/uncapped users pass).
  const tb = checkTokenBudget(c.get("user"));
  if (!tb.ok) return c.json({ error: budgetMessage(tb), resetAt: tb.resetAt }, 429);

  // Validate before streamSSE: after it starts the status is already 200, so a
  // missing model would surface as a broken SSE stream instead of a clean 400.
  if (!body.model) return c.json({ error: "model is required" }, 400);

  // Only declare tools we can actually execute server-side (web_search needs
  // TAVILY_API_KEY); an undeclared tool can never be called by the model.
  const tools = (body.tools ?? []).filter((t) => availableTools().includes(t));
  const specs = toolSpecs(tools);

  const allMessages: ChatMessage[] = body.messages ?? [];
  const { dropped, kept } = sliceContext(allMessages, body.contextWindow ?? 0);

  const messages: { role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string }[] =
    buildMessages({
      systemMode: body.systemMode ?? "append",
      system: body.system,
      promptInstructions: body.promptInstructions ?? [],
      soul: body.soul ?? null,
      facts: body.facts ?? [],
      skillInstructions: body.skillInstructions ?? [],
      messages: kept,
    });

  // Weak models claim "I cannot browse" unless told the tool exists; keep the
  // instruction only in tool-enabled requests so the cacheable prefix is stable.
  if (specs.length) {
    const sys = messages.find((m) => m.role === "system");
    const names = tools.join(", ");
    const guide = `# Tools\nYou have real tools available (${names}). When the answer needs fresh or external information, call the relevant tool instead of saying you cannot. Cite result URLs when present.\n# Asking the human\nChat has no pause mechanism: if you need the user's input to continue, ask the question in your reply text and stop. Structured pauses exist only in graph runs (the "human" node).`;
    if (sys) sys.content = `${sys.content}\n\n---\n\n${guide}`;
    else messages.unshift({ role: "system", content: guide });
  }

  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    c.req.raw.signal?.addEventListener("abort", () => ac.abort());
    const send = (ev: unknown) => stream.writeSSE({ data: JSON.stringify(ev) });
    // T-04: the whole user-visible message (all rounds) is one task row.
    const taskId = createTask("chat", body.model, c.get("user")?.username);
    let fail: string | null = null;

    // Rolling summary for the messages that fell out of the context window.
    // Failure is non-fatal: chat continues with the recent window only, but the
    // user must see that older context was lost (honesty over silence).
    if (dropped.length) {
      const key = spanKey(dropped, kept);
      let summary = body.regenSummary ? undefined : summaryCache.get(key);
      if (!summary) {
        try {
          summary = await summarizeDropped(dropped, body.model, c.get("user")?.username, body.summaryPrompt);
          if (summaryCache.size > 32) summaryCache.clear();
          summaryCache.set(key, summary);
        } catch (e: any) {
          await send({ type: "error", message: `context summary failed, continuing without it: ${String(e?.message ?? e)}` });
        }
      }
      if (summary) {
        const block = `# Earlier conversation (auto-summary of older messages)\n${summary}`;
        const sys = messages.find((m) => m.role === "system");
        if (sys) sys.content = `${sys.content}\n\n---\n\n${block}`;
        else messages.unshift({ role: "system", content: block });
      }
    }

    // Usage summed across every round of the loop so the client still sees
    // the full cost of one user-visible message.
    const totals = { prompt: 0, completion: 0, cached: 0, cost: 0 };

    outer: for (let round = 0; ; round++) {
      let res: Response;
      try {
        res = await openrouterChat({
          model: body.model,
          messages,
          temperature: body.temperature,
          reasoning: body.reasoning,
          tools: specs,
          signal: ac.signal,
        });
      } catch (e: any) {
        await send({ type: "error", message: String(e?.message ?? e) });
        finishTask(taskId, "error", undefined, String(e?.message ?? e));
        return;
      }

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        const msg = `OpenRouter ${res.status}: ${txt.slice(0, 300)}`;
        await send({ type: "error", message: msg });
        finishTask(taskId, "error", undefined, msg);
        return;
      }

      // Stream the round, accumulating content and fragmented tool_call deltas
      // (arguments may arrive split across chunks — index-keyed, per OpenAI).
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let text = "";
      const calls: ToolCallAccum = new Map();

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
            const delta = json.choices?.[0]?.delta;
            const think = delta?.reasoning ?? delta?.reasoning_content;
            if (typeof think === "string" && think) {
              await send({ type: "reasoning", text: think });
            }
            if (delta?.content) {
              text += delta.content;
              await send({ type: "token", text: delta.content });
            }
            for (const tc of delta?.tool_calls ?? []) {
              applyToolCallDelta(calls, tc);
            }
            if (json.usage) collectUsage(json.usage, totals); // final chunk (usage.include=true)
          }
        }
      } catch (e: any) {
        const msg = ac.signal.aborted ? "aborted by client" : String(e?.message ?? e);
        if (!ac.signal.aborted) await send({ type: "error", message: msg });
        finishTask(taskId, "error", { promptTokens: totals.prompt, completionTokens: totals.completion, cachedTokens: totals.cached, costUsd: totals.cost }, msg);
        return;
      }

      if (calls.size === 0) break; // plain answer, stream is complete

      if (round >= MAX_TOOL_ROUNDS) {
        await send({ type: "error", message: `tool loop reached ${MAX_TOOL_ROUNDS} rounds` });
        break;
      }

      // Replay this assistant turn (with its tool requests) into the history.
      messages.push({
        role: "assistant",
        content: text || null,
        tool_calls: [...calls.values()].map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.args },
        })),
      });

      for (const tc of calls.values()) {
        let args: Record<string, unknown> = {};
        try {
          args = tc.args ? JSON.parse(tc.args) : {};
        } catch {
          args = { query: "" }; // invalid JSON from the model → runTool reports it
        }
        const call = { id: tc.id, name: tc.name as ToolCall["name"], args };
        await send({ type: "tool_call", call });
        const t0 = Date.now();
        const result = await runTool(call.name, call.args);
        // T-19: one tool_events row per execution; a tool error is still an event.
        const err = (result as any)?.error;
        logToolEvent(taskId, call.name, args, !err, Date.now() - t0, err);
        await send({ type: "tool_result", callId: call.id, result });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, TOOL_RESULT_MAX_CHARS),
        });
      }
    }

    if (totals.prompt > 0 || totals.completion > 0) {
      const usage: Usage = {
        promptTokens: totals.prompt,
        completionTokens: totals.completion,
        cachedTokens: totals.cached,
        cachedPct: totals.prompt > 0 ? Math.round((totals.cached / totals.prompt) * 100) : 0,
        costUsd: totals.cost,
        provider: "openrouter",
        model: body.model,
      };
      await send({ type: "usage", usage });
    }

    finishTask(taskId, "ok", { promptTokens: totals.prompt, completionTokens: totals.completion, cachedTokens: totals.cached, costUsd: totals.cost });
    await send({ type: "done" });
  });
});

// Regenerate the rolling summary on demand (P5): same slice rule as the chat
// turn, always bypasses the cache so the user really gets a fresh generation,
// and refreshes the cache entry so the next chat turn picks it up.
chat.post("/summary", async (c) => {
  const body = await c.req.json() as {
    model: string; messages?: ChatMessage[]; contextWindow?: number; summaryPrompt?: string;
  };
  if (!body.model) return c.json({ error: "model is required" }, 400);
  const tb = checkTokenBudget(c.get("user"));
  if (!tb.ok) return c.json({ error: budgetMessage(tb), resetAt: tb.resetAt }, 429);
  const { dropped, kept } = sliceContext(body.messages ?? [], body.contextWindow ?? 0);
  if (!dropped.length) return c.json({ error: "nothing to summarize: no messages fell out of the context window" }, 400);
  try {
    const summary = await summarizeDropped(dropped, body.model, c.get("user")?.username, body.summaryPrompt);
    if (summaryCache.size > 32) summaryCache.clear();
    summaryCache.set(spanKey(dropped, kept), summary);
    return c.json({ summary, dropped: dropped.length, kept: kept.length });
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e) }, 502);
  }
});

function collectUsage(u: any, t: { prompt: number; completion: number; cached: number; cost: number }) {
  t.prompt += u.prompt_tokens ?? 0;
  t.completion += u.completion_tokens ?? 0;
  t.cached += u.prompt_tokens_details?.cached_tokens ?? 0;
  t.cost += u.cost ?? 0;
}

// Fold dropped history into one terse summary. Same model as the chat: no extra
// provider to configure, and the summary quality matches what the chat needs.
// The system prompt is user-overridable (P5 "prompt lato utente"); regenerable
// on demand via POST /summary, which bypasses and refreshes the cache.
const SUMMARY_TRANSCRIPT_MAX_CHARS = 24000;
const DEFAULT_SUMMARY_PROMPT =
  "Summarize this earlier conversation excerpt for use as context in a continuing chat. " +
  "Keep decisions, facts, names, file paths and open questions. Be terse; bullet points.";

// Same dropped set → same key, so a regenerated summary is picked up by the
// next chat turn without any extra wiring.
function spanKey(dropped: ChatMessage[], kept: ChatMessage[]): string {
  return `${dropped[0].id}:${dropped[dropped.length - 1].id}:${kept[0]?.id}`;
}

async function summarizeDropped(dropped: ChatMessage[], model: string, user?: string, summaryPrompt?: string): Promise<string> {
  const lines: string[] = [];
  let budget = SUMMARY_TRANSCRIPT_MAX_CHARS;
  for (const m of dropped) {
    const body = m.content.slice(0, 2000);
    const line = `${m.role}: ${body}`;
    if ((budget -= line.length) < 0) { lines.push("…[truncated]"); break; }
    lines.push(line);
  }
  const transcript = lines.join("\n");
  const taskId = createTask("summary", model, user);
  try {
    const { text, usageRaw } = await openrouterComplete({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: summaryPrompt?.trim() || DEFAULT_SUMMARY_PROMPT },
        { role: "user", content: transcript },
      ],
    });
    const u = usageRaw as any;
    finishTask(taskId, "ok", {
      promptTokens: u?.prompt_tokens,
      completionTokens: u?.completion_tokens,
      cachedTokens: u?.prompt_tokens_details?.cached_tokens,
      costUsd: u?.cost,
    });
    return text.trim();
  } catch (e: any) {
    finishTask(taskId, "error", undefined, String(e?.message ?? e));
    throw e;
  }
}
