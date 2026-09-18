import { useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import { useStore } from "../lib/store";
import { streamChat } from "../lib/sse";
import { apiGet, apiPost, apiPut } from "../lib/api";
import type { Attachment, Conversation, Usage } from "../types";
import Message from "../components/Message";
import Composer from "../components/Composer";
import ContextChips from "../components/ContextChips";

export default function Chat() {
  const s = useStore();

  // N3 auto-memory: after a batch of messages the chat goes idle → schedule one
  // background analysis of the conversation. Fire-and-forget: the one-shot
  // "only if messages.length > marker" rule lives server-side (analyzedCount).
  const IDLE_MS = 90_000;
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleAnalysis() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      const st = useStore.getState();
      if (!st.currentId || st.messages.length < 4) return;
      apiPost("/api/memory-analysis/analyze", { conversationId: st.currentId }).catch(() => {});
    }, IDLE_MS);
  }
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [s.messages]);

  async function persist(usage?: Usage) {
    const { messages, currentId, conversations, currentProjectId } = useStore.getState();
    const id = currentId ?? nanoid(12);
    const existing = conversations.find((c) => c.id === id);
    const conv: Conversation = {
      id,
      projectId: currentProjectId ?? undefined,
      title: existing?.title || (messages[0]?.content.slice(0, 60) || "New chat"),
      messages,
      usageTotal: [...(existing?.usageTotal ?? []), ...(usage ? [usage] : [])],
      updatedAt: Date.now(),
      nodeOrigin: "",
    };
    await apiPut(`/api/conversations/${id}`, conv).catch(() => {});
    if (!currentId) s.setCurrentId(id);
    const { items } = await apiGet<{ items: Conversation[] }>("/api/conversations")
      .catch(() => ({ items: conversations }));
    s.setConversations(items);
  }

  function buildContext() {
    const st = useStore.getState();
    const soul = st.memoryFiles.find((f) => f.id === st.activeSoulId)?.content ?? null;
    const facts = st.activeFactIds
      .map((id) => st.memoryFiles.find((f) => f.id === id))
      .filter(Boolean)
      .map((f) => `## ${f!.name}\n${f!.content}`);
    const skillInstructions = st.activeSkillIds
      .map((id) => st.skills.find((x) => x.id === id))
      .filter(Boolean)
      .map((sk) => `## ${sk!.name}\n${sk!.instructions}`);
    const promptInstructions = st.activePromptIds
      .map((id) => st.prompts.find((x) => x.id === id))
      .filter(Boolean)
      .map((p) => `## ${p!.name}\n${p!.content}`);
    // Skills declare tools: their union is what the server declares to the
    // provider for this call (Skill.tools[] bound at runtime).
    const tools = [...new Set(
      st.activeSkillIds
        .map((id) => st.skills.find((x) => x.id === id))
        .filter(Boolean)
        .flatMap((sk) => sk!.tools)
    )];
    return { soul, facts, skillInstructions, promptInstructions, tools };
  }

  async function send(text: string, attachments: Attachment[]) {
    const userMsg = {
      id: nanoid(10), role: "user" as const, content: text, createdAt: Date.now(),
      ...(attachments.length ? { attachments } : {}),
    };
    const asstMsg = { id: nanoid(10), role: "assistant" as const, content: "", createdAt: Date.now() };
    s.setMessages([...s.messages, userMsg, asstMsg]);
    s.setStreaming(true);
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }

    const ac = new AbortController();
    abortRef.current = ac;
    let usage: Usage | undefined;

    try {
      await streamChat(
        {
          model: s.model,
          systemMode: s.systemMode,
          system: s.system.trim() || undefined,
          temperature: s.temperature,
          reasoning: s.reasoning || undefined,
          stream: true,
          contextWindow: s.contextWindow || undefined,
          summaryPrompt: s.summaryPrompt.trim() || undefined,
          messages: [...useStore.getState().messages.slice(0, -1)],
          ...buildContext(),
        },
        (ev) => {
          if (ev.type === "token") s.appendToLast(ev.text);
          else if (ev.type === "reasoning") s.appendToLastReasoning(ev.text);
          else if (ev.type === "usage") { usage = ev.usage; s.setUsage(asstMsg.id, ev.usage); }
          else if (ev.type === "tool_call") s.attachToolCall(ev.call);
          else if (ev.type === "tool_result") s.appendToolResult(ev.callId, ev.result);
          else if (ev.type === "error") s.appendToLast(`\n[error] ${ev.message}`);
        },
        ac.signal
      );
    } catch (e: any) {
      if (!ac.signal.aborted) s.appendToLast(`\n[error] ${String(e?.message ?? e)}`);
    } finally {
      s.setStreaming(false);
      abortRef.current = null;
      await persist(usage);
      scheduleAnalysis();
    }
  }

  function stop() { abortRef.current?.abort(); }
  function removeMessage(id: string) {
    s.setMessages(useStore.getState().messages.filter((m) => m.id !== id));
    void persist();
  }
  const last = s.messages[s.messages.length - 1];

  // Text-only warning: active skills declare tools, but the selected model
  // cannot use them (OpenRouter would just receive useless tool schemas).
  const m = s.models.find((x) => x.id === s.model);
  const textOnly = buildContext().tools.length > 0 && m?.supportsTools === false;

  return (
    <main className="chat">
      {textOnly && (
        <div className="chat-warn muted">warning: {s.model} is text-only · active skills declare tools it cannot use</div>
      )}
      <div className="chat-scroll" ref={scrollRef}>
        {s.messages.length === 0 && (
          <div className="empty">
            <b>AI Harness</b>
            <span className="muted">model: {s.model} · mode: {s.systemMode}</span>
          </div>
        )}
         {s.messages.map((m) => (
          <Message
            key={m.id}
            msg={m}
            usage={s.usages[m.id]}
            streaming={s.streaming && m.id === last?.id && m.role === "assistant"}
            onDelete={s.streaming ? undefined : () => removeMessage(m.id)}
          />
        ))}


      </div>
      <ContextChips />
      <Composer onSend={send} onStop={stop} />
    </main>
  );
}
