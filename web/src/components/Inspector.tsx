import { useState } from "react";
import { useStore } from "../lib/store";
import { getToken, setToken } from "../lib/api";

export default function Inspector() {
  const s = useStore();
  const [tok, setTok] = useState(getToken());
  const lastUsage = Object.values(s.usages).at(-1);

  const souls = s.memoryFiles.filter((f) => f.kind === "soul");
  const facts = s.memoryFiles.filter((f) => f.kind === "fact");

  return (
    <aside className="inspector">
      <h3>Model</h3>
      <input list="models" value={s.model} onChange={(e) => s.setModel(e.target.value)} spellCheck={false} />
            <datalist id="models">
        {s.models.map((m) => (
          <option
            key={m.id}
            value={m.id}
            label={`${m.label}${m.inputPrice != null ? ` · $${m.inputPrice.toFixed(2)}/$${(m.outputPrice ?? 0).toFixed(2)} per 1M` : ""}`}
          />
        ))}
      </datalist>

      <h3>System override</h3>
      <div className="mode-toggle">
        {(["append", "replace"] as const).map((m) => (
          <button key={m} className={s.systemMode === m ? "mode active" : "mode"}
            onClick={() => s.setSystemMode(m)}>{m}</button>
        ))}
      </div>
      <textarea
        value={s.system}
        onChange={(e) => s.setSystem(e.target.value)}
        placeholder={s.systemMode === "replace"
          ? "Full custom system prompt (replaces base)"
          : "Extra instructions (appended to base)"}
        rows={5}
      />

      <h3>Temperature · {s.temperature.toFixed(1)}</h3>
      <input type="range" min={0} max={2} step={0.1} value={s.temperature}
        onChange={(e) => s.setTemperature(Number(e.target.value))} />

      <h3>Soul</h3>
      <div className="ctx-list">
        <label className="ctx-item">
          <input type="radio" name="soul-pick" checked={!s.activeSoulId} onChange={() => s.setActiveSoul(null)} />
          <span className="muted">none</span>
        </label>
        {souls.map((f) => (
          <label key={f.id} className="ctx-item">
            <input type="radio" name="soul-pick" checked={s.activeSoulId === f.id} onChange={() => s.setActiveSoul(f.id)} />
            {f.name}
          </label>
        ))}
      </div>

      <h3>Facts</h3>
      <div className="ctx-list">
        {facts.length === 0 && <span className="muted">none — create in Memory</span>}
        {facts.map((f) => (
          <label key={f.id} className="ctx-item">
            <input type="checkbox" checked={s.activeFactIds.includes(f.id)} onChange={() => s.toggleFact(f.id)} />
            {f.name}
          </label>
        ))}
      </div>

      <h3>Skills</h3>
      <div className="ctx-list">
        {s.skills.length === 0 && <span className="muted">none — create in Skills</span>}
        {s.skills.map((sk) => (
          <label key={sk.id} className="ctx-item">
            <input type="checkbox" checked={s.activeSkillIds.includes(sk.id)} onChange={() => s.toggleSkill(sk.id)} />
            {sk.name}
          </label>
        ))}
      </div>

      <h3>Last usage</h3>
      {lastUsage ? (
        <div className="usage-box">
          <div>prompt: {lastUsage.promptTokens} tok</div>
          <div>completion: {lastUsage.completionTokens} tok</div>
          <div>cached: {lastUsage.cachedTokens} ({lastUsage.cachedPct}%)</div>
          <div>cost: ${lastUsage.costUsd.toFixed(5)}</div>
        </div>
      ) : <div className="muted">no calls yet</div>}

      <h3>Auth token</h3>
      <input type="password" value={tok} placeholder="HARNESS_TOKEN (if set)"
        onChange={(e) => { setTok(e.target.value); setToken(e.target.value.trim()); }} />
    </aside>
  );
}
