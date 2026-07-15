import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { apiGet, apiPost, apiPut, getToken, setToken } from "../lib/api";

interface Health { ok: boolean; nodeId: string; hasKey: boolean; time: number }
interface Snap { name: string; size: number; at: number }

export default function Settings() {
  const s = useStore();
  const [health, setHealth] = useState<Health | null>(null);
  const [tok, setTok] = useState(getToken());
  const [busy, setBusy] = useState("");
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [peerUrl, setPeerUrl] = useState(localStorage.getItem("harness_peer") ?? "");
  const [peerTok, setPeerTok] = useState(localStorage.getItem("harness_peer_tok") ?? "");
  const [syncMsg, setSyncMsg] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    apiGet<Health>("/api/health").then(setHealth).catch(() => setHealth(null));
    loadSnaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadSnaps() {
    apiGet<{ items: Snap[] }>("/api/sync/snapshots").then((r) => setSnaps(r.items)).catch(() => {});
  }

  async function snapshotNow() {
    setBusy("creating snapshot…");
    try {
      const r = await apiPost<{ file: string; uploaded: boolean }>("/api/sync/snapshot", {});
      setBusy(`snapshot ${r.file} ✓${r.uploaded ? " · uploaded to B2 ✓" : ""}`);
      loadSnaps();
    } catch (e: any) {
      setBusy("snapshot failed: " + String(e?.message ?? e));
    }
  }

  async function pullFromPeer() {
    if (!peerUrl.trim()) return;
    localStorage.setItem("harness_peer", peerUrl.trim());
    localStorage.setItem("harness_peer_tok", peerTok.trim());
    setSyncMsg("pulling…");
    try {
      const r = await apiPost<{ applied: number; skipped: number }>("/api/sync/pull-from-peer", {
        peerUrl: peerUrl.trim(), token: peerTok.trim() || undefined,
      });
      setSyncMsg(`pulled ✓ · applied ${r.applied} · skipped ${r.skipped} — reload the page`);
    } catch (e: any) {
      setSyncMsg("pull failed: " + String(e?.message ?? e));
    }
  }

  async function exportAll() {
    setBusy("exporting…");
    const [skills, memory, projects, conversations, graphs] = await Promise.all([
      apiGet<{ items: unknown[] }>("/api/skills"),
      apiGet<{ items: unknown[] }>("/api/memory"),
      apiGet<{ items: unknown[] }>("/api/projects"),
      apiGet<{ items: unknown[] }>("/api/conversations"),
      apiGet<{ items: unknown[] }>("/api/graphs"),
    ]);
    const payload = {
      exportedAt: Date.now(),
      skills: skills.items, memory: memory.items, projects: projects.items,
      conversations: conversations.items, graphs: graphs.items,
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
      await put("/api/graphs", data.graphs);
      setBusy("imported ✓ — reload the page");
    } catch (e: any) {
      setBusy("import failed: " + String(e?.message ?? e));
    }
  }

  const fmtSize = (n: number) => n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

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

      <h3>Snapshots</h3>
      <div className="row-btns">
        <button className="btn" onClick={snapshotNow}>snapshot now</button>
      </div>
      {snaps.length > 0 && (
        <div className="usage-box">
          {snaps.slice(0, 8).map((sn) => (
            <div key={sn.name}>{sn.name} · {fmtSize(sn.size)} · {new Date(sn.at).toLocaleString()}</div>
          ))}
          {snaps.length > 8 && <div className="muted">…and {snaps.length - 8} more</div>}
        </div>
      )}

      <h3>Sync (pull from peer)</h3>
      <input placeholder="peer URL, e.g. http://10.0.0.5:8787" value={peerUrl}
        onChange={(e) => setPeerUrl(e.target.value)} spellCheck={false} />
      <input type="password" placeholder="peer HARNESS_TOKEN (if set)" value={peerTok}
        onChange={(e) => setPeerTok(e.target.value)} />
      <div className="row-btns">
        <button className="btn" onClick={pullFromPeer}>pull from peer</button>
      </div>
      {syncMsg && <div className="muted">{syncMsg}</div>}

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
