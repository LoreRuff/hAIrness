import { useState } from "react";
import { useStore } from "../lib/store";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { MemoryFile } from "../types";

const EMPTY = { kind: "fact" as "soul" | "fact", name: "", content: "" };

export default function Memory() {
  const s = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY);

  const souls = s.memoryFiles.filter((f) => f.kind === "soul");
  const facts = s.memoryFiles.filter((f) => f.kind === "fact");

  function open(f: MemoryFile) {
    setSel(f.id);
    setDraft({ kind: f.kind, name: f.name, content: f.content });
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
    if (!sel || !confirm("Delete this memory file?")) return;
    await apiDelete(`/api/memory/${sel}`);
    if (s.activeSoulId === sel) s.setActiveSoul(null);
    openNew();
    await refresh();
  }

  return (
    <main className="panel">
      <div className="panel-list">
        <button className="btn btn-block" onClick={openNew}>+ new file</button>

        <h3 className="list-head">soul (cacheable prefix)</h3>
        {souls.map((f) => (
          <div key={f.id} className={f.id === sel ? "item active" : "item"} onClick={() => open(f)}>
            <input
              type="radio" name="soul" title="active soul"
              checked={s.activeSoulId === f.id}
              onClick={(e) => e.stopPropagation()}
              onChange={() => s.setActiveSoul(s.activeSoulId === f.id ? null : f.id)}
            />
            <div className="item-main">{f.name}</div>
          </div>
        ))}
        {s.activeSoulId && (
          <button className="btn-ghost" onClick={() => s.setActiveSoul(null)}>clear active soul</button>
        )}

        <h3 className="list-head">facts</h3>
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
      </div>

      <div className="panel-editor">
        <h3>{sel ? "Edit file" : "New file"}</h3>
        <div className="mode-toggle">
          {(["soul", "fact"] as const).map((k) => (
            <button key={k} className={draft.kind === k ? "mode active" : "mode"}
              onClick={() => setDraft({ ...draft, kind: k })}>{k}</button>
          ))}
        </div>
        <input placeholder='name (e.g. "soul.md", "infra.md")' value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <textarea rows={18} placeholder="markdown content" value={draft.content}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        <div className="row-btns">
          <button className="btn" onClick={save}>save</button>
          {sel && <button className="btn btn-stop" onClick={remove}>delete</button>}
        </div>
      </div>
    </main>
  );
}
