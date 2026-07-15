import { useState } from "react";
import { useStore } from "../lib/store";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { Project } from "../types";

const EMPTY = {
  name: "", description: "", defaultModel: "",
  activeSkills: [] as string[], soul: null as string | null, facts: [] as string[],
};

export default function Projects() {
  const s = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY);

  const souls = s.memoryFiles.filter((f) => f.kind === "soul");
  const factFiles = s.memoryFiles.filter((f) => f.kind === "fact");

  function open(p: Project) {
    setSel(p.id);
    setDraft({
      name: p.name,
      description: p.description ?? "",
      defaultModel: p.defaultModel ?? "",
      activeSkills: p.activeSkills ?? [],
      soul: p.activeMemory?.soul ?? null,
      facts: p.activeMemory?.facts ?? [],
    });
  }
  function openNew() { setSel(null); setDraft(EMPTY); }

  function toggleDraftSkill(id: string) {
    setDraft((d) => ({
      ...d,
      activeSkills: d.activeSkills.includes(id)
        ? d.activeSkills.filter((x) => x !== id)
        : [...d.activeSkills, id],
    }));
  }
  function toggleDraftFact(id: string) {
    setDraft((d) => ({
      ...d,
      facts: d.facts.includes(id) ? d.facts.filter((x) => x !== id) : [...d.facts, id],
    }));
  }

  async function refresh() {
    const { items } = await apiGet<{ items: Project[] }>("/api/projects");
    s.setProjects(items);
  }

  async function save() {
    if (!draft.name.trim()) return;
    const row = {
      name: draft.name,
      description: draft.description,
      defaultModel: draft.defaultModel || undefined,
      activeSkills: draft.activeSkills,
      activeMemory: { soul: draft.soul, facts: draft.facts },
    };
    if (sel) await apiPut(`/api/projects/${sel}`, { ...row, id: sel });
    else { const created = await apiPost<Project>("/api/projects", row); setSel(created.id); }
    await refresh();
  }

  async function remove() {
    if (!sel || !confirm("Delete this project?")) return;
    await apiDelete(`/api/projects/${sel}`);
    if (s.currentProjectId === sel) s.setCurrentProjectId(null);
    openNew();
    await refresh();
  }

  function applyToChat() {
    if (draft.defaultModel.trim()) s.setModel(draft.defaultModel.trim());
    s.setActiveSoul(draft.soul);
    // replace active facts/skills with project's ones
    for (const id of [...s.activeFactIds]) if (!draft.facts.includes(id)) s.toggleFact(id);
    for (const id of draft.facts) if (!s.activeFactIds.includes(id)) s.toggleFact(id);
    for (const id of [...s.activeSkillIds]) if (!draft.activeSkills.includes(id)) s.toggleSkill(id);
    for (const id of draft.activeSkills) if (!s.activeSkillIds.includes(id)) s.toggleSkill(id);
    s.setCurrentProjectId(sel);
    s.setView("chat");
  }

  return (
    <main className="panel">
      <div className="panel-list">
        <button className="btn btn-block" onClick={openNew}>+ new project</button>
        {s.projects.map((p) => (
          <div key={p.id} className={p.id === sel ? "item active" : "item"} onClick={() => open(p)}>
            <div className="item-main">
              <div>{p.name} {p.id === s.currentProjectId && <span className="badge">active</span>}</div>
              <div className="muted item-sub">{p.description}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="panel-editor">
        <h3>{sel ? "Edit project" : "New project"}</h3>
        <input placeholder="name" value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input placeholder="description" value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        <input list="models" placeholder="default model (optional)" value={draft.defaultModel}
          onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })} spellCheck={false} />

        <h3>Soul</h3>
        <div className="ctx-list">
          <label className="ctx-item">
            <input type="radio" name="proj-soul" checked={!draft.soul}
              onChange={() => setDraft({ ...draft, soul: null })} />
            <span className="muted">none</span>
          </label>
          {souls.map((f) => (
            <label key={f.id} className="ctx-item">
              <input type="radio" name="proj-soul" checked={draft.soul === f.id}
                onChange={() => setDraft({ ...draft, soul: f.id })} />
              {f.name}
            </label>
          ))}
        </div>

        <h3>Facts</h3>
        <div className="ctx-list">
          {factFiles.map((f) => (
            <label key={f.id} className="ctx-item">
              <input type="checkbox" checked={draft.facts.includes(f.id)}
                onChange={() => toggleDraftFact(f.id)} />
              {f.name}
            </label>
          ))}
        </div>

        <h3>Skills</h3>
        <div className="ctx-list">
          {s.skills.map((sk) => (
            <label key={sk.id} className="ctx-item">
              <input type="checkbox" checked={draft.activeSkills.includes(sk.id)}
                onChange={() => toggleDraftSkill(sk.id)} />
              {sk.name}
            </label>
          ))}
        </div>

        <div className="row-btns">
          <button className="btn" onClick={save}>save</button>
          {sel && <button className="btn" onClick={applyToChat}>apply to chat ▶</button>}
          {sel && <button className="btn btn-stop" onClick={remove}>delete</button>}
        </div>
      </div>
    </main>
  );
}
