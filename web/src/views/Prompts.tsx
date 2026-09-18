import { useState } from "react";
import { useStore } from "../lib/store";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { PromptFile } from "../types";

const EMPTY = { name: "", description: "", content: "" };

export default function Prompts() {
  const s = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY);

  function open(p: PromptFile) {
    setSel(p.id);
    setDraft({ name: p.name, description: p.description ?? "", content: p.content });
  }
  function openNew() { setSel(null); setDraft(EMPTY); }

  async function refresh() {
    const { items } = await apiGet<{ items: PromptFile[] }>("/api/prompts");
    s.setPrompts(items);
  }

  async function save() {
    if (!draft.name.trim()) return;
    const base = sel ? s.prompts.find((x) => x.id === sel) : undefined;
    const row = { ...(base ?? {}), ...draft };
    if (sel) await apiPut(`/api/prompts/${sel}`, { ...row, id: sel });
    else { const created = await apiPost<PromptFile>("/api/prompts", row); setSel(created.id); }
    await refresh();
  }

  async function remove() {
    if (!sel || !confirm("Delete this prompt?")) return;
    await apiDelete(`/api/prompts/${sel}`);
    openNew();
    await refresh();
  }

  return (
    <main className="panel">
      <div className="panel-list">
        <button className="btn btn-block" onClick={openNew}>+ new prompt</button>
        {s.prompts.map((p) => (
          <div key={p.id} className={p.id === sel ? "item active" : "item"} onClick={() => open(p)}>
            <input
              type="checkbox" title="active in chat"
              checked={s.activePromptIds.includes(p.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => s.togglePrompt(p.id)}
            />
            <div className="item-main">
              <div>{p.name}</div>
              <div className="muted item-sub">{p.description}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="panel-editor">
        <h3>{sel ? "Edit prompt" : "New prompt"}</h3>
        <input placeholder="name" value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input placeholder="description" value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        <textarea rows={16} placeholder="system persona — injected as # Personas when active"
          value={draft.content}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        <div className="row-btns">
          <button className="btn" onClick={save}>save</button>
          {sel && <button className="btn btn-stop" onClick={remove}>delete</button>}
        </div>
      </div>
    </main>
  );
}
