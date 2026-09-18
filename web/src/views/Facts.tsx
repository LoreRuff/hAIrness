import { useState } from "react";
import { useStore } from "../lib/store";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { MemoryFile } from "../types";

// Facts split from the old Memory view (N2): single-kind list + editor, the
// checkboxes inject files into chat. Souls live in Soul.tsx.
const EMPTY = { kind: "fact" as const, name: "", content: "" };

export default function Facts() {
  const s = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY);

  const facts = s.memoryFiles.filter((f) => f.kind === "fact");

  function open(f: MemoryFile) {
    setSel(f.id);
    setDraft({ kind: "fact", name: f.name, content: f.content });
  }
  function openNew() { setSel(null); setDraft(EMPTY); }

  async function refresh() {
    const { items } = await apiGet<{ items: MemoryFile[] }>("/api/memory");
    s.setMemoryFiles(items);
  }

  async function save() {
    if (!draft.name.trim()) return;
    if (sel) await apiPut(`/api/memory/${sel}`, { ...draft, id: sel });
    else { const created = await apiPost<MemoryFile>("/api/memory", draft); setSel(created.id); }
    await refresh();
  }

  async function remove() {
    if (!sel || !confirm("Delete this fact file?")) return;
    await apiDelete(`/api/memory/${sel}`);
    openNew();
    await refresh();
  }

  return (
    <main className="panel">
      <div className="panel-list">
        <button className="btn btn-block" onClick={openNew}>+ new fact</button>

        {facts.map((f) => (
          <div key={f.id} className={f.id === sel ? "item active" : "item"} onClick={() => open(f)}>
            <input
              type="checkbox" title="inject in chat"
              checked={s.activeFactIds.includes(f.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => s.toggleFact(f.id)}
            />
            <div className="item-main">{f.name}</div>
          </div>
        ))}
        {facts.length === 0 && <span className="muted">no fact files yet</span>}
      </div>

      <div className="panel-editor">
        <h3>{sel ? "Edit fact" : "New fact"}</h3>
        <input placeholder='name (e.g. "infra.md")' value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <textarea rows={18} placeholder="markdown content — injected when active" value={draft.content}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        <div className="row-btns">
          <button className="btn" onClick={save}>save</button>
          {sel && <button className="btn btn-stop" onClick={remove}>delete</button>}
        </div>
      </div>
    </main>
  );
}
