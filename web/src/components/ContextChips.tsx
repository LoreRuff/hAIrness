import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";

// Context summary as removable chips + one list-style picker (the model-selector
// pattern, not checkboxes buried in side panels): what the next message will
// carry stays visible at all times, one click away.
export default function ContextChips() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Click-outside dismiss: the picker must not force aiming at the small toggle.
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const soul = s.memoryFiles.find((f) => f.id === s.activeSoulId);
  const facts = s.activeFactIds.map((id) => s.memoryFiles.find((f) => f.id === id));
  const skills = s.activeSkillIds.map((id) => s.skills.find((x) => x.id === id));
  const prompts = s.activePromptIds.map((id) => s.prompts.find((x) => x.id === id));

  const souls = s.memoryFiles.filter((f) => f.kind === "soul");
  const factList = s.memoryFiles.filter((f) => f.kind === "fact");

  return (
    <div className="chips-bar" ref={rootRef}>
      {soul && (
        <span className="chip kind-soul">🧠 {soul.name}
          <button className="chip-x" onClick={() => s.setActiveSoul(null)}>×</button>
        </span>
      )}
      {prompts.map((p) => p && (
        <span key={p.id} className="chip kind-prompt">📜 {p.name}
          <button className="chip-x" onClick={() => s.togglePrompt(p.id)}>×</button>
        </span>
      ))}
      {facts.map((f) => f && (
        <span key={f.id} className="chip kind-fact">📄 {f.name}
          <button className="chip-x" onClick={() => s.toggleFact(f.id)}>×</button>
        </span>
      ))}
      {skills.map((sk) => sk && (
        <span key={sk.id} className="chip kind-skill">⚡ {sk.name}
          <button className="chip-x" onClick={() => s.toggleSkill(sk.id)}>×</button>
        </span>
      ))}
      <button className="chip chip-plus" onClick={() => setOpen(!open)}>+ context</button>

      {open && (
        <div className="picker">
          <div className="picker-head">Personas</div>
          {s.prompts.length === 0 && <div className="muted picker-empty">none — create in Prompts</div>}
          {s.prompts.map((p) => (
            <div key={p.id}
              className={s.activePromptIds.includes(p.id) ? "pick on" : "pick"}
              onClick={() => s.togglePrompt(p.id)}>
              📜 {p.name} {p.description && <span className="muted">· {p.description}</span>}
            </div>
          ))}

          <div className="picker-head">Soul</div>
          <div className={!s.activeSoulId ? "pick on" : "pick"} onClick={() => s.setActiveSoul(null)}>
            ✕ none
          </div>
          {souls.map((f) => (
            <div key={f.id}
              className={s.activeSoulId === f.id ? "pick on" : "pick"}
              onClick={() => s.setActiveSoul(f.id)}>
              🧠 {f.name}
            </div>
          ))}

          <div className="picker-head">Facts</div>
          {factList.length === 0 && <div className="muted picker-empty">none — create in Memory</div>}
          {factList.map((f) => (
            <div key={f.id}
              className={s.activeFactIds.includes(f.id) ? "pick on" : "pick"}
              onClick={() => s.toggleFact(f.id)}>
              📄 {f.name}
            </div>
          ))}

          <div className="picker-head">Skills</div>
          {s.skills.length === 0 && <div className="muted picker-empty">none — create in Skills</div>}
          {s.skills.map((sk) => (
            <div key={sk.id}
              className={s.activeSkillIds.includes(sk.id) ? "pick on" : "pick"}
              onClick={() => s.toggleSkill(sk.id)}>
              ⚡ {sk.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
