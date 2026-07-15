import { useEffect } from "react";
import { useStore, type ViewId } from "./lib/store";
import { apiGet } from "./lib/api";
import type { Conversation, ModelInfo } from "./types";
import Chat from "./views/Chat";
import Inspector from "./components/Inspector";

const RAIL: { id: ViewId; icon: string; label: string }[] = [
  { id: "chat", icon: "💬", label: "Chat" },
  { id: "skills", icon: "⚡", label: "Skills" },
  { id: "memory", icon: "🧠", label: "Memory" },
  { id: "projects", icon: "📁", label: "Projects" },
  { id: "settings", icon: "⚙️", label: "Settings" },
];

export default function App() {
  const s = useStore();

  useEffect(() => {
    apiGet<{ items: ModelInfo[] }>("/api/models")
      .then((r) => s.setModels(r.items)).catch(() => {});
    apiGet<{ items: Conversation[] }>("/api/conversations")
      .then((r) => s.setConversations(r.items)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openConversation(c: Conversation) {
    s.setCurrentId(c.id);
    s.setMessages(c.messages ?? []);
  }

  function newChat() {
    s.setCurrentId(null);
    s.setMessages([]);
  }

  return (
    <div className="layout">
      <nav className="rail">
        {RAIL.map((r) => (
          <button
            key={r.id}
            title={r.label}
            className={s.view === r.id ? "rail-btn active" : "rail-btn"}
            onClick={() => s.setView(r.id)}
          >{r.icon}</button>
        ))}
      </nav>

      <aside className="sidebar">
        <button className="btn btn-block" onClick={newChat}>+ new chat</button>
        <div className="conv-list">
          {s.conversations.map((c) => (
            <div
              key={c.id}
              className={c.id === s.currentId ? "conv active" : "conv"}
              onClick={() => openConversation(c)}
            >
              <div className="conv-title">{c.title || "untitled"}</div>
              <div className="conv-date">{new Date(c.updatedAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </aside>

      {s.view === "chat"
        ? <Chat />
        : <main className="chat"><div className="empty"><b>{s.view}</b><span className="muted">coming in the next round</span></div></main>}

      <Inspector />
    </div>
  );
}
