import { useEffect, useState } from "react";
import { useStore, type ViewId } from "../lib/store";
import { applyTheme } from "../lib/palette";

interface Action { id: string; icon: string; label: string; run: () => void }

// Subsequence match is enough: people type fragments, not prefixes.
function fuzzy(q: string, text: string): boolean {
  const p = q.toLowerCase();
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of t) if (i < p.length && ch === p[i]) i++;
  return i >= p.length;
}

// Ctrl+K jumps anywhere: views, conversations, graphs, persona toggles —
// no deep navigation needed, the keyboard stays on the home row.
export default function Palette() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQ(""); setIdx(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!open) return null;

  const views: { id: ViewId; icon: string; label: string }[] = [
    { id: "chat", icon: "💬", label: "Chat" },
    { id: "nodes", icon: "🕸️", label: "Nodes" },
    { id: "library", icon: "📚", label: "Library" },
    { id: "settings", icon: "⚙️", label: "Settings" },
  ];

  // UI-8: everything toggleable/navigable lives here — views, chats, graphs,
  // personas, skills, memory (soul/facts), projects, themes, layout panels.
  const actions: Action[] = [
    {
      id: "new-chat", icon: "✨", label: "new chat",
      run: () => { s.setCurrentId(null); s.setMessages([]); s.setView("chat"); s.closePanels(); },
    },
    ...(["dark", "light", "black"] as const).map((t) => ({
      id: `theme-${t}`, icon: "◐", label: `theme: ${t}`,
      run: () => applyTheme(t),
    })),
    { id: "toggle-sidebar", icon: "▤", label: "toggle sidebar", run: s.toggleSidebar },
    { id: "toggle-inspector", icon: "▥", label: "toggle inspector", run: s.toggleInspector },
    { id: "ctx-all", icon: "⇔", label: "context: full history", run: () => s.setContextWindow(0) },
    { id: "ctx-none", icon: "∅", label: "context: current message only", run: () => s.setContextWindow(1) },
    ...views.map((v) => ({
      id: `view-${v.id}`, icon: v.icon, label: `go to ${v.label}`,
      run: () => { s.setView(v.id); s.closePanels(); },
    })),
    ...s.conversations.map((c) => ({
      id: `conv-${c.id}`, icon: "💬", label: `open chat — ${c.title || "untitled"}`,
      run: () => { s.setCurrentId(c.id); s.setMessages(c.messages ?? []); s.setView("chat"); s.closePanels(); },
    })),
    ...s.graphs.map((g) => ({
      id: `graph-${g.id}`, icon: "🕸️", label: `open graph — ${g.name}`,
      run: () => { s.setFocusGraphId(g.id); s.setView("nodes"); s.closePanels(); },
    })),
    ...s.prompts.map((p) => ({
      id: `prompt-${p.id}`, icon: "📜",
      label: `${s.activePromptIds.includes(p.id) ? "deactivate" : "activate"} persona — ${p.name}`,
      run: () => s.togglePrompt(p.id),
    })),
    ...s.skills.map((sk) => ({
      id: `skill-${sk.id}`, icon: "⚡",
      label: `${s.activeSkillIds.includes(sk.id) ? "deactivate" : "activate"} skill — ${sk.name}`,
      run: () => s.toggleSkill(sk.id),
    })),
    { id: "soul-clear", icon: "🧠", label: "clear soul", run: () => s.setActiveSoul(null) },
    ...s.memoryFiles.filter((f) => f.kind === "soul").map((f) => ({
      id: `soul-${f.id}`, icon: "🧠", label: `use soul — ${f.name}`,
      run: () => s.setActiveSoul(f.id),
    })),
    ...s.memoryFiles.filter((f) => f.kind === "fact").map((f) => ({
      id: `fact-${f.id}`, icon: "🗒️",
      label: `${s.activeFactIds.includes(f.id) ? "deactivate" : "activate"} fact — ${f.name}`,
      run: () => s.toggleFact(f.id),
    })),
    ...s.projects.map((p) => ({
      id: `project-${p.id}`, icon: "📁", label: `filter chats by project — ${p.name}`,
      run: () => s.setCurrentProjectId(p.id),
    })),
  ];

  const results = q ? actions.filter((a) => fuzzy(q, a.label)) : actions;
  const exec = (a?: Action) => { if (a) a.run(); setOpen(false); };

  return (
    <div className="palette-overlay" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="jump to… views, chats, skills, memory, themes (↑↓ · Enter)"
          value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); exec(results[idx]); }
          }}
        />
        <div className="palette-list">
          {results.map((a, i) => (
            <div key={a.id} className={i === idx ? "pal-item active" : "pal-item"}
              onMouseEnter={() => setIdx(i)}
              onClick={() => exec(a)}>
              <span className="pal-icon">{a.icon}</span> {a.label}
            </div>
          ))}
          {results.length === 0 && <div className="muted pal-empty">no matches</div>}
        </div>
      </div>
    </div>
  );
}
