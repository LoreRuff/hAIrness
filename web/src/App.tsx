import Nodes from "./views/Nodes";
import { useEffect, useState } from "react";
import { useStore, type ViewId, applyHarness } from "./lib/store";
import { apiDelete, apiGet, apiPut, getToken } from "./lib/api";
import type { AuthRole, Conversation, Graph, Harness, MemoryFile, ModelInfo, Project, PromptFile, Skill } from "./types";
import Chat from "./views/Chat";
import Users from "./views/Users";
import Library from "./views/Library";
import Settings from "./views/Settings";
import Login from "./views/Login";
import Inspector from "./components/Inspector";
import Palette from "./components/Palette";
import { notify, requestNotificationPermission } from "./lib/notify";

const RAIL: { id: ViewId; icon: string; label: string }[] = [
  { id: "chat", icon: "💬", label: "Chat" },
  { id: "nodes", icon: "🕸️", label: "Nodes" },
  { id: "library", icon: "📚", label: "Library" },
  { id: "settings", icon: "⚙️", label: "Settings" },
  { id: "users", icon: "👤", label: "Users" },
];

export default function App() {
  const s = useStore();
  const [authState, setAuthState] = useState<"checking" | "login" | "ok">("checking");

  function loadAll() {
    apiGet<{ items: ModelInfo[] }>("/api/models").then((r) => s.setModels(r.items)).catch(() => {});
    apiGet<{ items: Graph[] }>("/api/graphs").then((r) => s.setGraphs(r.items)).catch(() => {});
    apiGet<{ items: Conversation[] }>("/api/conversations").then((r) => s.setConversations(r.items)).catch(() => {});
    apiGet<{ items: Skill[] }>("/api/skills").then((r) => s.setSkills(r.items)).catch(() => {});
    apiGet<{ items: PromptFile[] }>("/api/prompts").then((r) => s.setPrompts(r.items)).catch(() => {});
    apiGet<{ items: MemoryFile[] }>("/api/memory").then((r) => s.setMemoryFiles(r.items)).catch(() => {});
    apiGet<{ items: Project[] }>("/api/projects").then((r) => s.setProjects(r.items)).catch(() => {});
    apiGet<{ items: Harness[] }>("/api/harnesses").then((r) => {
      s.setHarnesses(r.items);
      // persisted harness stays the source of truth across reloads
      const h = r.items.find((x) => x.id === s.harnessId);
      if (h) applyHarness(h);
    }).catch(() => {});
  }

  useEffect(() => {
    // Boot gate: verify the stored session via a raw fetch (api() would reload
    // on 401, which would loop before the login gate exists).
    (async () => {
      if (!getToken()) { setAuthState("login"); return; }
      try {
        const r = await fetch("/api/auth/session", { headers: { Authorization: `Bearer ${getToken()}` } });
        if (!r.ok) throw new Error("unauthorized");
        // Role gates the owner-only rail entries (Users); fresh session every boot.
        s.setRole(((await r.json()) as { role: AuthRole }).role);
        loadAll();
        setAuthState("ok");
        // "Battesimo": ask once per browser at first load, so run
        // notifications (human pause, completion) work before the first run.
        requestNotificationPermission();
      } catch {
        localStorage.removeItem("harness_token");
        setAuthState("login");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openConversation(c: Conversation) {
    s.setCurrentId(c.id);
    s.setMessages(c.messages ?? []);
    s.setView("chat");
    s.closePanels();
  }

  function newChat() {
    s.setCurrentId(null);
    s.setMessages([]);
    s.setView("chat");
    s.closePanels();
  }

  function renameConv(c: Conversation) {
    const title = window.prompt("Rename conversation", c.title)?.trim();
    if (!title || title === c.title) return;
    const next = { ...c, title };
    apiPut(`/api/conversations/${c.id}`, next).then(() => {
      s.setConversations(s.conversations.map((x) => (x.id === c.id ? { ...x, title } : x)));
    }).catch(() => {});
  }

  function deleteConv(c: Conversation) {
    if (!window.confirm(`Delete "${c.title || "untitled"}"?`)) return;
    apiDelete(`/api/conversations/${c.id}`).then(() => {
      s.setConversations(s.conversations.filter((x) => x.id !== c.id));
      if (c.id === s.currentId) newChat();
    }).catch(() => {});
  }

  const currentProject = s.projects.find((p) => p.id === s.currentProjectId);

  // Toast auto-dismiss: one timer per message, cleared on change/unmount.
  useEffect(() => {
    if (!s.toast) return;
    const t = setTimeout(() => s.setToast(null), 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.toast]);

  // Global Escape = back (N4 anti-sinkhole). Overlays handle their own Escape
  // and stay in the DOM only while open, so their presence here means the key
  // belongs to them — skip navigation. No state plumbing needed.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (document.querySelector(".palette-overlay, .gen-modal")) return;
      if (useStore.getState().viewStack.length > 0) useStore.getState().back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (authState === "checking") return <div className="boot muted">hAIrness · connecting…</div>;
  if (authState === "login") return <Login onAuthed={() => { loadAll(); setAuthState("ok"); }} />;

  const layoutClass =
    "layout" +
    // sidebar + chat Inspector exist only in Chat; other views are full width
    (s.view === "chat" ? "" : " full") +
    (s.showSidebar ? " show-sidebar" : "") +
    (s.showInspector ? " show-inspector" : "");

  return (
    <div className={layoutClass}>
      {s.viewStack.length > 0 && (
        <button id="btn-back" className="topbar-btn" onClick={s.back} title="back">←</button>
      )}
      {/* Conversation history and chat Inspector exist only in the Chat view:
          every other view brings its own left/right panels. */}
      {s.view === "chat" && <button id="btn-sidebar" className="topbar-btn" onClick={s.toggleSidebar}>☰</button>}
      {s.view === "chat" && <button id="btn-inspector" className="topbar-btn" onClick={s.toggleInspector}>⚙</button>}
      {(s.showSidebar || s.showInspector) && <div className="backdrop" onClick={s.closePanels} />}

      <nav className="rail">
        {/* Users panel is owner-only: hidden, not merely disabled, so non-owner
            sessions never see the entry point at all. */}
        {RAIL.filter((r) => r.id !== "users" || s.role === "owner").map((r) => (
          <button key={r.id} title={r.label}
            className={s.view === r.id ? "rail-btn active" : "rail-btn"}
            onClick={() => { s.setView(r.id); s.closePanels(); }}>{r.icon}</button>
        ))}
      </nav>

      {s.view === "chat" && <aside className="sidebar">
        {currentProject && (
          <div className="project-banner">
            📁 {currentProject.name}
            <button className="btn-ghost" onClick={() => s.setCurrentProjectId(null)}>×</button>
          </div>
        )}
        <button className="btn btn-block" onClick={newChat}>+ new chat</button>
        <div className="conv-list">
          {s.conversations
            .filter((c) => !s.currentProjectId || c.projectId === s.currentProjectId)
            .map((c) => (
              <div key={c.id}
                className={c.id === s.currentId ? "conv active" : "conv"}
                onClick={() => openConversation(c)}>
                <div className="conv-title">{c.title || "untitled"}</div>
                <div className="conv-date">{new Date(c.updatedAt).toLocaleString()}</div>
                <div className="conv-ops" onClick={(e) => e.stopPropagation()}>
                  <button className="conv-op" title="rename" onClick={() => renameConv(c)}>✎</button>
                  <button className="conv-op conv-del" title="delete" onClick={() => deleteConv(c)}>✕</button>
                </div>
              </div>
            ))}
        </div>
      </aside>}

      {s.view === "chat" && <Chat />}
      {s.view === "nodes" && <Nodes />}
      {s.view === "library" && <Library />}
      {s.view === "settings" && <Settings />}
      {s.view === "users" && s.role === "owner" && <Users />}

      {s.view === "chat" && <Inspector />}
      <Palette />
      {s.toast && (
        <div className="toast" onClick={() => s.setToast(null)} role="status">
          {s.toast}
        </div>
      )}
    </div>
  );
}
