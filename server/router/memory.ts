import { Hono } from "hono";
import { nanoid } from "nanoid";
import { getRow, upsertRow, createTask, finishTask } from "../db.ts";
import { checkTokenBudget, budgetMessage } from "../core/budget.ts";
import type { Env } from "../core/auth.ts";
import { openrouterComplete } from "../core/openrouter.ts";
import type { ChatMessage, Conversation, MemoryFile } from "../../shared/types.ts";

// N3: automatic memory. When a chat goes idle the client pings /analyze here.
// One-shot semantics live in the conversation row itself: `analyzedCount` is
// the number of messages already covered by a past analysis, so a batch of
// new prompts yields exactly one analysis when idle returns (not per message).
const MIN_MESSAGES = 4;      // below this a chat has nothing durable to learn
const MAX_MSGS = 40;         // transcript cap: recent window only
const MSG_CHARS = 400;       // per-message truncation
const DEFAULT_MODEL = "openai/gpt-4o-mini";

export const memory = new Hono<Env>();

function transcript(messages: ChatMessage[]): string {
  const recent = messages.slice(-MAX_MSGS);
  const first = messages.length - recent.length + 1;
  return recent.map((m, i) => {
    const body = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return `#${first + i} ${m.role}: ${body.slice(0, MSG_CHARS)}`;
  }).join("\n");
}

memory.post("/analyze", async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const tb = checkTokenBudget(c.get("user"));
  if (!tb.ok) return c.json({ error: budgetMessage(tb), resetAt: tb.resetAt }, 429);
  const conv = getRow<Conversation>("conversations", String(body.conversationId ?? ""));
  if (!conv) return c.json({ error: "conversation not found" }, 404);

  const marker = (conv as any).analyzedCount ?? 0;
  if (conv.messages.length <= marker) {
    return c.json({ skipped: "nothing new since last analysis" });
  }
  if (conv.messages.length < MIN_MESSAGES) {
    return c.json({ skipped: "too few messages" });
  }

  const model = String(body.model || DEFAULT_MODEL);
  const from = marker + 1;
  const to = conv.messages.length;
  const taskId = createTask("summary", model, c.get("user")?.username);
  try {
    const { text, usageRaw } = await openrouterComplete({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You extract what the USER is interested in from a conversation excerpt. " +
            "Reply with STRICT JSON only: {\"interests\": [\"...\"]}. " +
            "Each entry: one durable interest, preference, recurring theme or working style of the user " +
            "(not one-off task details). Max 8 entries, one sentence each, same language as the chat.",
        },
        { role: "user", content: transcript(conv.messages) },
      ],
    });
    const u = usageRaw as any;
    finishTask(taskId, "ok", {
      promptTokens: u?.prompt_tokens,
      completionTokens: u?.completion_tokens,
      cachedTokens: u?.prompt_tokens_details?.cached_tokens,
      costUsd: u?.cost,
    });

    let interests: string[] = [];
    try {
      const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (Array.isArray(j.interests)) interests = j.interests.filter((x: unknown) => typeof x === "string" && x.trim()).slice(0, 8);
    } catch { /* unparseable output: skip writing a junk row */ }
    if (interests.length === 0) {
      // Marker still advances: retrying the same batch every idle would bill forever.
      (conv as any).analyzedCount = to;
      upsertRow("conversations", conv);
      return c.json({ ok: true, created: null });
    }

    const row: MemoryFile = {
      id: nanoid(10),
      kind: "auto",
      name: `auto · ${conv.title || "untitled"} · msgs ${from}-${to}`,
      content: interests.map((i) => `- ${i}`).join("\n"),
      updatedAt: Date.now(),
      nodeOrigin: "",
    };
    upsertRow("memory_files", row);
    (conv as any).analyzedCount = to;
    upsertRow("conversations", conv);
    return c.json({ ok: true, created: row });
  } catch (e: any) {
    finishTask(taskId, "error", undefined, String(e?.message ?? e));
    return c.json({ error: String(e?.message ?? e) }, 502);
  }
});
