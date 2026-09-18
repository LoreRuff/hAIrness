import { useState } from "react";
import { apiPost } from "../lib/api";
import type { AgentNode } from "../types";

// Proposal preview is intentionally an editable JSON textarea, not a form:
// the user reviews and tweaks the raw config, then Apply validates again
// server-side-free (shape was validated by the generator already).
interface Props {
  mode: "node" | "graph";
  graphId: string | null;
  models: string[];
  defaultModel: string;
  onClose: () => void;
  onApplyNode: (n: AgentNode) => void;
  onApplyGraph: (g: { name: string; nodes: AgentNode[]; edges: { from: string; to: string }[] }) => void;
}

export default function GenerateModal(p: Props) {
  const [description, setDescription] = useState("");
  const [model, setModel] = useState(p.defaultModel);
  const [proposal, setProposal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (!description.trim() || busy) return;
    setBusy(true); setError(""); setProposal("");
    try {
      const r = await apiPost<{ proposal: unknown }>("/api/graph/generate", {
        mode: p.mode, description, model, graphId: p.graphId ?? undefined, models: p.models,
      });
      setProposal(JSON.stringify(r.proposal, null, 2));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    try {
      const parsed = JSON.parse(proposal);
      if (p.mode === "node") p.onApplyNode(parsed as AgentNode);
      else p.onApplyGraph(parsed);
      p.onClose();
    } catch (e: any) {
      setError(`invalid JSON: ${String(e?.message ?? e)}`);
    }
  }

  return (
    <div className="backdrop" style={{ zIndex: 900 }} onClick={p.onClose}>
      <div className="gen-modal" onClick={(e) => e.stopPropagation()}>
        <h3>✨ {p.mode === "node" ? "Generate node" : "Generate graph"}</h3>
        <textarea rows={4} autoFocus placeholder="describe WHAT the node/graph must do…"
          value={description} onChange={(e) => setDescription(e.target.value)} />
        <input list="models" placeholder="generator model" value={model} spellCheck={false}
          onChange={(e) => setModel(e.target.value)} />
        <div className="row-btns">
          <button className="btn" onClick={() => void generate()} disabled={busy || !description.trim()}>
            {busy ? "generating…" : "generate"}
          </button>
          {proposal && <button className="btn" onClick={apply}>apply ▶</button>}
          <span className="spacer" />
          <button className="btn-ghost" onClick={p.onClose}>close</button>
        </div>
        {error && <div className="rl-error">✗ {error}</div>}
        {proposal && (
          <>
            <div className="muted" style={{ fontSize: 11 }}>
              proposal — edit before applying if needed
            </div>
            <textarea className="gen-json" rows={16} spellCheck={false}
              value={proposal} onChange={(e) => setProposal(e.target.value)} />
          </>
        )}
      </div>
    </div>
  );
}
