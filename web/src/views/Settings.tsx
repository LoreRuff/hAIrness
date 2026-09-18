import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { apiGet, apiPost, apiPut, getToken } from "../lib/api";
import { schedulePrefsPush } from "../lib/prefs";
import { applyAccent, applyTheme, currentMode } from "../lib/palette";

interface Health { ok: boolean; nodeId: string; hasKey: boolean; time: number }
interface Session { ok: boolean; user: string }
interface Snap { name: string; size: number; at: number }
interface Metrics {
  totals: { calls?: number; prompt?: number; completion?: number; cached?: number; cost?: number };
  daily: { day: string; model: string; kind: string; calls: number; prompt: number; completion: number; cached: number; cost: number }[];
  tools: { name: string; calls: number; okCalls: number; avgMs: number }[];
}

export default function Settings() {
  const s = useStore();
  const [health, setHealth] = useState<Health | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [mets, setMets] = useState<Metrics | null>(null);
  const [busy, setBusy] = useState("");
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [peerUrl, setPeerUrl] = useState(localStorage.getItem("harness_peer") ?? "");
  const [peerTok, setPeerTok] = useState(localStorage.getItem("harness_peer_tok") ?? "");
  const [syncMsg, setSyncMsg] = useState("");
  const [theme, setThemeState] = useState(localStorage.getItem("harness_theme") || "dark");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // UI-3 color wheel: the accent picker derives the whole palette (surfaces
  // included) via HSL with WCAG contrast enforcement, in lib/palette.ts.
  // Default = the live --accent token, so no hex ever lives in the TSX.
  const [accent, setAccentState] = useState(
    localStorage.getItem("harness_accent") ||
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
  );

  function setAccent(v: string) {
    setAccentState(v);
    if (v) {
      localStorage.setItem("harness_accent", v);
      applyAccent(v, currentMode());
    } else {
      localStorage.removeItem("harness_accent");
      applyAccent(null, currentMode());
    }
    schedulePrefsPush();
  }

  useEffect(() => {
    apiGet<Health>("/api/health").then(setHealth).catch(() => setHealth(null));
    apiGet<Session>("/api/auth/session").then(setSession).catch(() => setSession(null));
    apiGet<Metrics>("/api/metrics").then(setMets).catch(() => setMets(null));
    loadSnaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout() {
    // Raw fetch: api() reloads on 401; we want the clean path out.
    fetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
    }).catch(() => {}).finally(() => {
      localStorage.removeItem("harness_token");
      window.location.reload();
    });
  }

  // UI-2: three base modes. Persisted per user (aesthetic prefs only — never
  // tokens, lesson H3) and applied on <html> so the whole sheet re-themes.
  // Logic lives in lib/palette.ts: the Ctrl+K palette switches themes too.
  function setTheme(t: "dark" | "light" | "black") {
    setThemeState(t);
    applyTheme(t);
  }

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

      <h3>Usage</h3>
      <div className="usage-box">
        {mets && mets.totals?.calls
          ? <>
            <div>{mets.totals.calls} LLM calls · {mets.totals.prompt ?? 0} prompt tok ({mets.totals.cached ?? 0} cached) · {mets.totals.completion ?? 0} completion tok</div>
            <div>total cost: ${Number(mets.totals.cost ?? 0).toFixed(4)}</div>
            {mets.daily.slice(0, 7).map((d, i) => (
              <div key={i} className="muted">{d.day} · {d.model} ({d.kind}) · {d.calls} call(s) · ${Number(d.cost).toFixed(4)}</div>
            ))}
            {mets.tools.map((t, i) => (
              <div key={i} className="muted">tool {t.name}: {t.calls} call(s) · {t.okCalls} ok · avg {t.avgMs}ms</div>
            ))}
          </>
          : <div className="muted">no usage yet</div>}
      </div>

      <h3>Session</h3>
      <div className="usage-box">
        {session
          ? <div>signed in as {session.user}</div>
          : <div className="muted">session check failed</div>}
        <div className="row-btns">
          <button className="btn" onClick={logout}>log out</button>
        </div>
      </div>

      <h3>Default model</h3>
      <input list="models" value={s.model} onChange={(e) => s.setModel(e.target.value)} spellCheck={false} />

      <h3>Theme</h3>
      <div className="mode-toggle">
        {(["dark", "light", "black"] as const).map((t) => (
          <button key={t} className={theme === t ? "mode active" : "mode"}
            onClick={() => setTheme(t)}>{t}</button>
        ))}
      </div>

      <h3>Accent color</h3>
      <div className="row-btns">
        <input type="color" className="accent-pick" value={accent} title="accent"
          onChange={(e) => setAccent(e.target.value)} />
        {accent && <button className="btn-ghost" onClick={() => setAccent("")}>reset</button>}
      </div>
      <label className="ctx-item muted">Hue and saturation derive the whole palette; contrast is checked automatically.</label>

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
