import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { Skill } from "../types";

const EMPTY = { name: "", description: "", instructions: "", tools: "" };

export default function Skills() {
  const s = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  // R-B: tools the server can actually run right now (web_search + mcp_*).
  // MCP discovery lands a beat after boot, so we read it lazily and refetch
  // when the editor opens rather than trusting a mount-time snapshot.
  const [avail, setAvail] = useState<string[]>([]);

  async function fetchTools() {
    try { setAvail((await apiGet<{ tools: string[] }>("/api/tools")).tools); }
    catch { /* auth-less or offline: hide the hints, never block the editor */ }
  }
  useEffect(() => { void fetchTools(); }, [sel]);

  function open(sk: Skill) {
    setSel(sk.id);
    setDraft({ name: sk.name, description: sk.description, instructions: sk.instructions, tools: sk.tools.join(", ") });
  }
  function openNew() { setSel(null); setDraft(EMPTY); }

  async function refresh() {
    const { items } = await apiGet<{ items: Skill[] }>("/api/skills");
    s.setSkills(items);
  }

  async function save() {
    if (!draft.name.trim()) return;
    const base = sel ? s.skills.find((x) => x.id === sel) : undefined;
    const tools = draft.tools.split(",").map((t) => t.trim()).filter(Boolean);
    const row = { ...(base ?? { files: { soul: null, facts: [] }, scope: "global" }), ...draft, tools };
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
        <input placeholder="tools — comma-separated (web_search, mcp_demo_echo, …) bound when the skill is active"
          value={draft.tools}
          onChange={(e) => setDraft({ ...draft, tools: e.target.value })} />
        {(() => {
          const declared = draft.tools.split(",").map((x) => x.trim()).filter(Boolean);
          const missing = avail.filter((t) => !declared.includes(t));
          if (missing.length === 0) return null;
          const insert = (t: string) =>
            setDraft({ ...draft, tools: declared.concat(t).join(", ") });
          return (
            <div className="tool-hints">
              <span className="muted">available:</span>
              {missing.map((t) =>
                <button key={t} type="button" className="chip" title="insert into tools"
                  onClick={() => insert(t)}>{t}</button>)}
            </div>
          );
        })()}
        <div className="row-btns">
          <button className="btn" onClick={save}>save</button>
          {sel && <button className="btn btn-stop" onClick={remove}>delete</button>}
        </div>
      </div>
    </main>
  );
}
