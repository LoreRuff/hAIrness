import { useState } from "react";
import { useStore } from "../lib/store";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { Skill } from "../types";

const EMPTY = { name: "", description: "", instructions: "" };

export default function Skills() {
  const s = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY);

  function open(sk: Skill) {
    setSel(sk.id);
    setDraft({ name: sk.name, description: sk.description, instructions: sk.instructions });
  }
  function openNew() { setSel(null); setDraft(EMPTY); }

  async function refresh() {
    const { items } = await apiGet<{ items: Skill[] }>("/api/skills");
    s.setSkills(items);
  }

  async function save() {
    if (!draft.name.trim()) return;
    const base = sel ? s.skills.find((x) => x.id === sel) : undefined;
    const row = { ...(base ?? { tools: [], files: { soul: null, facts: [] }, scope: "global" }), ...draft };
    if (sel) await apiPut(`/api/skills/${sel}`, { ...row, id: sel });
    else { const created = await apiPost<Skill>("/api/skills", row); setSel(created.id); }
    await refresh();
  }

  async function remove() {
    if (!sel || !confirm("Delete this skill?")) return;
    await apiDelete(`/api/skills/${sel}`);
    openNew();
    await refresh();
  }

  return (
    <main className="panel">
      <div className="panel-list">
        <button className="btn btn-block" onClick={openNew}>+ new skill</button>
        {s.skills.map((sk) => (
          <div key={sk.id} className={sk.id === sel ? "item active" : "item"} onClick={() => open(sk)}>
            <input
              type="checkbox" title="active in chat"
              checked={s.activeSkillIds.includes(sk.id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => s.toggleSkill(sk.id)}
            />
            <div className="item-main">
              <div>{sk.name}</div>
              <div className="muted item-sub">{sk.description}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="panel-editor">
        <h3>{sel ? "Edit skill" : "New skill"}</h3>
        <input placeholder="name" value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input placeholder="description" value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        <textarea rows={16} placeholder="instructions — injected into the system prompt when active"
          value={draft.instructions}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
        <div className="row-btns">
          <button className="btn" onClick={save}>save</button>
          {sel && <button className="btn btn-stop" onClick={remove}>delete</button>}
        </div>
      </div>
    </main>
  );
}
