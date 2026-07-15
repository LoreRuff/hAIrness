import { useStore } from "../lib/store";
import { getToken, setToken } from "../lib/api";
import { useState } from "react";

export default function Inspector() {
  const s = useStore();
  const [tok, setTok] = useState(getToken());
  const lastUsage = Object.values(s.usages).at(-1);

  return (
    <aside className="inspector">
      <h3>Model</h3>
      <input
        list="models"
        value={s.model}
        onChange={(e) => s.setModel(e.target.value)}
        spellCheck={false}
      />
      <datalist id="models">
        {s.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.inputPrice != null ? `$${m.inputPrice.toFixed(2)}/$${(m.outputPrice ?? 0).toFixed(2)} per 1M` : m.label}
          </option>
        ))}
      </datalist>

      <h3>System override</h3>
      <div className="mode-toggle">
        {(["append", "replace"] as const).map((m) => (
          <button
            key={m}
            className={s.systemMode === m ? "mode active" : "mode"}
            onClick={() => s.setSystemMode(m)}
          >{m}</button>
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
      <input
        type="range" min={0} max={2} step={0.1}
        value={s.temperature}
        onChange={(e) => s.setTemperature(Number(e.target.value))}
      />

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
      <input
        type="password"
        value={tok}
        placeholder="HARNESS_TOKEN (if set)"
        onChange={(e) => { setTok(e.target.value); setToken(e.target.value.trim()); }}
      />
    </aside>
  );
}
