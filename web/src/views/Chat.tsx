import { useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import { useStore } from "../lib/store";
import { streamChat } from "../lib/sse";
import { apiGet, apiPut } from "../lib/api";
import type { Attachment, Conversation, Usage } from "../types";
import Message from "../components/Message";
import Composer from "../components/Composer";

export default function Chat() {
  const s = useStore();
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
    return { soul, facts, skillInstructions };
  }

  async function send(text: string, attachments: Attachment[]) {
    const userMsg = {
      id: nanoid(10), role: "user" as const, content: text, createdAt: Date.now(),
      ...(attachments.length ? { attachments } : {}),
    };
    const asstMsg = { id: nanoid(10), role: "assistant" as const, content: "", createdAt: Date.now() };
    s.setMessages([...s.messages, userMsg, asstMsg]);
    s.setStreaming(true);

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
          stream: true,
          messages: [...useStore.getState().messages.slice(0, -1)],
          ...buildContext(),
        },
        (ev) => {
          if (ev.type === "token") s.appendToLast(ev.text);
          else if (ev.type === "usage") { usage = ev.usage; s.setUsage(asstMsg.id, ev.usage); }
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
    }
  }

  function stop() { abortRef.current?.abort(); }
  function removeMessage(id: string) {
    s.setMessages(useStore.getState().messages.filter((m) => m.id !== id));
    void persist();
  }
  const last = s.messages[s.messages.length - 1];

  return (
    <main className="chat">
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
      <Composer onSend={send} onStop={stop} />
    </main>
  );
}
