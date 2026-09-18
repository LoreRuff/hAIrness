import { useEffect, useState } from "react";
import { nanoid } from "nanoid";
import { useStore, applyHarness, effortsFor } from "../lib/store";
import ModelPicker from "./ModelPicker";
import Sec from "./Sec";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { Harness } from "../types";

// While a harness is active the Inspector edits it: every control also writes
// through to the harness row (debounced PUT; each content change snapshots a
// version server-side). Detached = ad-hoc state only, nothing persisted.
const PUT_DELAY = 800;
let putTimer: ReturnType<typeof setTimeout> | null = null;

export default function Inspector() {
  const s = useStore();
  const lastUsage = Object.values(s.usages).at(-1);
  const [newName, setNewName] = useState("");

  const souls = s.memoryFiles.filter((f) => f.kind === "soul");
  const facts = s.memoryFiles.filter((f) => f.kind === "fact");
  const harness = s.harnesses.find((h) => h.id === s.harnessId) ?? null;

  function refresh() {
    apiGet<{ items: Harness[] }>("/api/harnesses")
      .then((r) => s.setHarnesses(r.items))
      .catch(() => {});
  }

  function patchHarness(patch: Partial<Harness>) {
    if (!harness) return;
    const next = { ...harness, ...patch };
    // optimistic: local list shows the edit immediately
    s.setHarnesses(s.harnesses.map((h) => (h.id === next.id ? next : h)));
    if (putTimer) clearTimeout(putTimer);
    putTimer = setTimeout(() => {
      putTimer = null;
      apiPut(`/api/harnesses/${next.id}`, next).then(refresh).catch(() => {});
    }, PUT_DELAY);
  }

  function select(id: string) {
    if (!id) { s.setHarnessId(null); return; }
    const h = s.harnesses.find((x) => x.id === id);
    if (!h) { s.setHarnessId(null); return; }
    applyHarness(h);
    s.setHarnessId(id);
  }

  async function saveAs() {
    const h: Harness = {
      id: nanoid(10),
      name: newName.trim() || "harness",
      rev: 1,
      model: s.model,
      systemMode: s.systemMode,
      system: s.system || undefined,
      promptIds: s.activePromptIds,
      skills: s.activeSkillIds,
      memory: { soul: s.activeSoulId, facts: s.activeFactIds },
      tools: [],
      temperature: s.temperature,
      contextWindow: s.contextWindow,
      updatedAt: Date.now(),
      nodeOrigin: "",
    };
    try {
      await apiPost("/api/harnesses", h);
      setNewName("");
      s.setHarnessId(h.id);
      refresh();
    } catch { /* row stays ad-hoc on failure */ }
  }

  async function removeActive() {
    if (!harness) return;
    s.setHarnessId(null);
    await apiDelete(`/api/harnesses/${harness.id}`).catch(() => {});
    refresh();
  }

  // Write-through wrappers: ad-hoc state always updates; the harness (if any)
  // receives the same change so the two never diverge while attached.
  const setModel = (m: string) => { s.setModel(m); patchHarness({ model: m }); };
  const setSystemMode = (m: "append" | "replace") => { s.setSystemMode(m); patchHarness({ systemMode: m }); };
  const setSystem = (v: string) => { s.setSystem(v); patchHarness({ system: v || undefined }); };
  const setTemperature = (t: number) => { s.setTemperature(t); patchHarness({ temperature: t }); };
  const setReasoning = (r: string) => { s.setReasoning(r); patchHarness({ reasoning: r || undefined }); };
  const toggleIn = (current: string[], setter: (ids: string[]) => void, field: "promptIds" | "skills", id: string) => {
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setter(next);
    patchHarness({ [field]: next });
  };
  const setFacts = (ids: string[]) => { s.setActiveFactIds(ids); patchHarness({ memory: { soul: s.activeSoulId, facts: ids } }); };
  const setSoul = (id: string | null) => { s.setActiveSoul(id); patchHarness({ memory: { soul: id, facts: s.activeFactIds } }); };
  const rename = (name: string) => { patchHarness({ name }); };
  const setCtx = (cw: number) => { s.setContextWindow(cw); patchHarness({ contextWindow: cw }); };
  const ctxVal = () => s.contextWindow === 0 ? "all" : s.contextWindow === 1 ? "none" : `last ${s.contextWindow - 1} + new`;

  // Accordion sections: shared Sec component (also used by the node Config).
  const shortModel = s.model.split("/").pop() || s.model;

  // R-D: mirror of the Chat.tsx union — active skills declare tools, the
  // server runs only what /api/tools reports. Declared-but-unavailable is the
  // silent hole this section exists to expose ("vedo solo web search").
  const [availTools, setAvailTools] = useState<string[]>([]);
  useEffect(() => {
    apiGet<{ tools: string[] }>("/api/tools").then((r) => setAvailTools(r.tools)).catch(() => {});
  }, [s.activeSkillIds, s.skills]);
  const declaredTools = [...new Set(
    s.activeSkillIds
      .map((id) => s.skills.find((x) => x.id === id))
      .filter(Boolean)
      .flatMap((sk) => sk!.tools)
  )];
  const deadTools = declaredTools.filter((t) => !availTools.includes(t));

  return (
    <aside className="inspector">
      <Sec title="Harness" open>
        <select value={s.harnessId ?? ""} onChange={(e) => select(e.target.value)}>
          <option value="">ad-hoc (not saved)</option>
          {s.harnesses.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
        {harness ? (
          <div className="harness-bar">
            <input value={harness.name} spellCheck={false}
              onChange={(e) => rename(e.target.value)} />
            <span className="muted">rev {harness.rev} · edits saved automatically</span>
            <button className="btn btn-sm" onClick={removeActive}>delete</button>
          </div>
        ) : (
          <div className="harness-bar">
            <input placeholder="name to save current setup" value={newName} spellCheck={false}
              onChange={(e) => setNewName(e.target.value)} />
            <button className="btn btn-sm" disabled={!newName.trim()} onClick={saveAs}>save as</button>
          </div>
        )}
      </Sec>

      <Sec title="Model" val={shortModel} open>
        <ModelPicker value={s.model} onChange={setModel} />
      </Sec>

      <Sec title="System override" val={s.systemMode} open={!!s.system}>
        <div className="mode-toggle">
          {(["append", "replace"] as const).map((m) => (
            <button key={m} className={s.systemMode === m ? "mode active" : "mode"}
              onClick={() => setSystemMode(m)}>{m}</button>
          ))}
        </div>
        <textarea
          value={s.system}
          onChange={(e) => setSystem(e.target.value)}
          placeholder={s.systemMode === "replace"
            ? "Full custom system prompt (replaces base)"
            : "Extra instructions (appended to base)"}
          rows={5}
        />
        <div className="muted inspector-hint">ad-hoc extra — reusable personas live in 📜 Prompts</div>
      </Sec>

      <Sec title="Personas" val={s.activePromptIds.length ? `${s.activePromptIds.length} active` : undefined}>
        <div className="ctx-list">
          {s.prompts.length === 0 && <span className="muted">none — create in Prompts</span>}
          {s.prompts.map((p) => (
            <label key={p.id} className="ctx-item">
              <input type="checkbox" checked={s.activePromptIds.includes(p.id)}
                onChange={() => toggleIn(s.activePromptIds, s.setActivePromptIds, "promptIds", p.id)} />
              {p.name}
            </label>
          ))}
        </div>
      </Sec>

      <Sec title="Temperature" val={s.temperature.toFixed(1)}>
        <input type="range" min={0} max={2} step={0.1} value={s.temperature}
          onChange={(e) => setTemperature(Number(e.target.value))} />
      </Sec>

      <Sec title="Reasoning effort" val={s.reasoning || "auto"}>
        <select value={s.reasoning} onChange={(e) => setReasoning(e.target.value)}>
          <option value="">auto (model default)</option>
          {effortsFor(s.models, s.model).map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </Sec>

      {/* Context window: the select (all/none) and the numeric limit are mutually
       * exclusive by design (owner rule). Wire mapping: 0 = all, 1 = current only,
       * N+1 = N contextual messages + the one being sent. */}
      <Sec title="Context window" val={ctxVal()}>
        <select
          value={s.contextWindow === 0 ? "all" : "none"}
          disabled={s.contextWindow >= 2}
          onChange={(e) => setCtx(e.target.value === "all" ? 0 : 1)}
        >
          <option value="all">all — full history</option>
          <option value="none">none — current message only</option>
        </select>
        <label className="ctx-item">
          <input
            type="checkbox"
            checked={s.contextWindow >= 2}
            onChange={(e) => setCtx(e.target.checked ? 11 : 0)}
          />
          limit to N contextual messages
        </label>
        {s.contextWindow >= 2 && (
          <input
            type="number"
            min={1}
            aria-label="contextual messages"
            value={s.contextWindow - 1}
            onChange={(e) => setCtx(Math.max(1, Math.floor(Number(e.target.value) || 1)) + 1)}
          />
        )}
        {s.contextWindow >= 2 && (
          <SummaryTools />
        )}
        <div className="muted inspector-hint">older messages are folded into an automatic summary</div>
      </Sec>

      <Sec title="Soul" val={souls.find((f) => f.id === s.activeSoulId)?.name}>
        <div className="ctx-list">
          <label className="ctx-item">
            <input type="radio" name="soul-pick" checked={!s.activeSoulId} onChange={() => setSoul(null)} />
            <span className="muted">none</span>
          </label>
          {souls.map((f) => (
            <label key={f.id} className="ctx-item">
              <input type="radio" name="soul-pick" checked={s.activeSoulId === f.id} onChange={() => setSoul(f.id)} />
              {f.name}
            </label>
          ))}
        </div>
      </Sec>

      <Sec title="Facts" val={s.activeFactIds.length ? `${s.activeFactIds.length} active` : undefined}>
        <div className="ctx-list">
          {facts.length === 0 && <span className="muted">none — create in Memory</span>}
          {facts.map((f) => (
            <label key={f.id} className="ctx-item">
              <input type="checkbox" checked={s.activeFactIds.includes(f.id)}
                onChange={() => {
                  const next = s.activeFactIds.includes(f.id)
                    ? s.activeFactIds.filter((x) => x !== f.id)
                    : [...s.activeFactIds, f.id];
                  setFacts(next);
                }} />
              {f.name}
            </label>
          ))}
        </div>
      </Sec>

      <Sec title="Skills" val={s.activeSkillIds.length ? `${s.activeSkillIds.length} active` : undefined}>
        <div className="ctx-list">
          {s.skills.length === 0 && <span className="muted">none — create in Skills</span>}
          {s.skills.map((sk) => (
            <label key={sk.id} className="ctx-item">
              <input type="checkbox" checked={s.activeSkillIds.includes(sk.id)}
                onChange={() => toggleIn(s.activeSkillIds, s.setActiveSkillIds, "skills", sk.id)} />
              {sk.name}
            </label>
          ))}
        </div>
      </Sec>

      <Sec title="Tools" val={declaredTools.length ? `${declaredTools.length} active` : undefined}>
        {declaredTools.length === 0
          ? <div className="muted inspector-hint">no active skill declares tools — the model sees none</div>
          : (
            <div className="ctx-list">
              {declaredTools.map((t) => (
                <div key={t} className={deadTools.includes(t) ? "ctx-item dead" : "ctx-item"}>
                  {t}{deadTools.includes(t) && <span className="muted"> — not available on server</span>}
                </div>
              ))}
            </div>
          )}
        {deadTools.length > 0 &&
          <div className="muted inspector-hint">declared by an active skill but missing server-side: fix the Tools field in Skills</div>}
      </Sec>

      <Sec title="Last usage" val={lastUsage ? `$${lastUsage.costUsd.toFixed(5)}` : undefined}>
        {lastUsage ? (
          <div className="usage-box">
            <div>prompt: {lastUsage.promptTokens} tok</div>
            <div>completion: {lastUsage.completionTokens} tok</div>
            <div>cached: {lastUsage.cachedTokens} ({lastUsage.cachedPct}%)</div>
            <div>cost: ${lastUsage.costUsd.toFixed(5)}</div>
          </div>
        ) : <div className="muted">no calls yet</div>}
      </Sec>
    </aside>
  );
}

// P5: the rolling summary is user-steerable and regenerable. The textarea sets
// the summarizer's system prompt (empty = server default); the button forces a
// fresh generation from the current history and shows it, so the user can read
// exactly what the model will see of the older conversation.
function SummaryTools() {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ summary: string; dropped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setBusy(true); setError(null);
    try {
      const r = await apiPost<{ summary: string; dropped: number; kept: number }>("/api/chat/summary", {
        model: s.model,
        messages: useStore.getState().messages,
        contextWindow: s.contextWindow,
        summaryPrompt: s.summaryPrompt.trim() || undefined,
      });
      setResult({ summary: r.summary, dropped: r.dropped });
    } catch (e: any) {
      setResult(null);
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <textarea
        rows={3}
        aria-label="summary prompt"
        placeholder="summary prompt — empty = default (decisions, facts, names, paths, open questions)"
        value={s.summaryPrompt}
        onChange={(e) => s.setSummaryPrompt(e.target.value)}
      />
      <button className="btn-ghost" onClick={() => void regenerate()} disabled={busy || !s.model}>
        {busy ? "summarizing…" : "↻ regenerate summary"}
      </button>
      {error && <div className="muted" style={{ fontSize: 11 }}>{error}</div>}
      {result && (
        <details className="ctx-item" open>
          <summary style={{ cursor: "pointer" }}>summary · {result.dropped} older messages</summary>
          <pre className="ctx-item" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{result.summary}</pre>
        </details>
      )}
    </>
  );
}
