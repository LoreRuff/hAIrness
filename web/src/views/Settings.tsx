import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { apiGet, apiPut, getToken, setToken } from "../lib/api";

interface Health { ok: boolean; nodeId: string; hasKey: boolean; time: number }

export default function Settings() {
  const s = useStore();
  const [health, setHealth] = useState<Health | null>(null);
  const [tok, setTok] = useState(getToken());
  const [busy, setBusy] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    apiGet<Health>("/api/health").then(setHealth).catch(() => setHealth(null));
  }, []);

  async function exportAll() {
    setBusy("exporting…");
    const [skills, memory, projects, conversations] = await Promise.all([
      apiGet<{ items: unknown[] }>("/api/skills"),
      apiGet<{ items: unknown[] }>("/api/memory"),
      apiGet<{ items: unknown[] }>("/api/projects"),
      apiGet<{ items: unknown[] }>("/api/conversations"),
    ]);
    const payload = {
      exportedAt: Date.now(),
      skills: skills.items, memory: memory.items,
      projects: projects.items, conversations: conversations.items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `harness-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setBusy("");
  }

  async function importAll(f: File) {
    setBusy("importing…");
    try {
      const data = JSON.parse(await f.text());
      const put = (path: string, rows: any[]) =>
        Promise.all((rows ?? []).map((r) => apiPut(`${path}/${r.id}`, r)));
      await put("/api/skills", data.skills);
      await put("/api/memory", data.memory);
      await put("/api/projects", data.projects);
      await put("/api/conversations", data.conversations);
      setBusy("imported ✓ — reload the page");
    } catch (e: any) {
      setBusy("import failed: " + String(e?.message ?? e));
    }
  }

  return (
    <main className="settings">
      <h3>Node</h3>
      <div className="usage-box">
        {health ? (
          <>
            <div>status: {health.ok ? "ok ✓" : "error"}</div>
            <div>nodeId: {health.nodeId}</div>
            <div>OpenRouter key: {health.hasKey ? "present ✓" : "MISSING ✗"}</div>
          </>
        ) : <div className="muted">health check failed — server unreachable?</div>}
      </div>

      <h3>Auth token</h3>
      <input type="password" value={tok} placeholder="HARNESS_TOKEN (if set)"
        onChange={(e) => { setTok(e.target.value); setToken(e.target.value.trim()); }} />

      <h3>Default model</h3>
      <input list="models" value={s.model} onChange={(e) => s.setModel(e.target.value)} spellCheck={false} />

      <h3>Composer</h3>
      <label className="ctx-item">
        <input type="checkbox" checked={s.enterToSend} onChange={s.toggleEnterToSend} />
        Enter sends the message (Shift+Enter = newline)
      </label>

      <h3>Data</h3>
      <div className="row-btns">
        <button className="btn" onClick={exportAll}>export all (JSON)</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>import…</button>
        <input ref={fileRef} type="file" accept="application/json" hidden
          onChange={(e) => { if (e.target.files?.[0]) importAll(e.target.files[0]); e.target.value = ""; }} />
      </div>
      {busy && <div className="muted">{busy}</div>}
    </main>
  );
}
