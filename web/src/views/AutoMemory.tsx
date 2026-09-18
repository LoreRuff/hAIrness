// Auto memory (N3): per-user knowledge derived by the harness from idle chat
// analysis — one analysis per chat, one per new batch of prompts. Populated
// by the idle-analyzer job; the chat Inspector exposes it like any context.
import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { apiDelete, apiGet } from "../lib/api";
import type { MemoryFile } from "../types";

export default function AutoMemory() {
  const s = useStore();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const { items } = await apiGet<{ items: MemoryFile[] }>("/api/memory");
      s.setMemoryFiles(items);
    } finally { setBusy(false); }
  }
  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const derived = s.memoryFiles.filter((f) => f.kind === "auto");

  async function remove(id: string) {
    if (!confirm("Delete this derived memory?")) return;
    await apiDelete(`/api/memory/${id}`);
    await refresh();
  }

  return (
    <main className="panel">
      <div className="panel-list">
        <div className="list-head">learned from your chats · per user</div>
        {busy && <span className="muted">refreshing…</span>}
        {derived.map((f) => (
          <div key={f.id} className="item" title={f.content}>
            <div className="item-main">{f.name}</div>
            <button className="btn-ghost" onClick={() => remove(f.id)}>×</button>
          </div>
        ))}
        {derived.length === 0 && (
          <span className="muted">nothing learned yet — it appears after a chat goes idle</span>
        )}
      </div>
      <div className="panel-editor">
        <h3>How it works</h3>
        <p className="muted">
          When a chat goes idle the harness analyzes it and learns what interests you.
          One analysis per chat, then one per new batch of prompts. The knowledge here
          is yours (per user), inspectable and deletable.
        </p>
      </div>
    </main>
  );
}
