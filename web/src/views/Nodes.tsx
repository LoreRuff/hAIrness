import { useState } from "react";
import { useStore } from "../lib/store";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import { streamEvents } from "../lib/sse";
import { nanoid } from "nanoid";
import type { Graph, JuryNode, PipelineNode, SingleNode, SystemMode } from "../types";

interface LogEntry {
  kind: "start" | "output" | "final" | "usage" | "error" | "done";
  title?: string;
  body?: string;
}


type Kind = "pipeline" | "jury";
interface StepDraft { name: string; model: string; system: string; mode: SystemMode }

const STEP: StepDraft = { name: "", model: "", system: "", mode: "append" };

export default function Nodes() {
  const s = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("pipeline");
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([{ ...STEP }]);
  const [panel, setPanel] = useState<string[]>(["", ""]);
  const [judge, setJudge] = useState("");
  const [criteria, setCriteria] = useState("accuracy, clarity, completeness");
  const [jurySystem, setJurySystem] = useState("");
  const [input, setInput] = useState("");
const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);

  function openNew() {
    setSel(null); setKind("pipeline"); setName("");
    setSteps([{ ...STEP }]); setPanel(["", ""]); setJudge("");
    setCriteria("accuracy, clarity, completeness"); setJurySystem(""); setLog([]);
  }

  function open(g: Graph) {
    setSel(g.id); setName(g.name); setLog([]);
    const root = g.nodes[0];
    if (root?.type === "pipeline") {
      setKind("pipeline");
      const children = (root as PipelineNode).steps
        .map((id) => g.nodes.find((n) => n.id === id) as SingleNode | undefined)
        .filter(Boolean) as SingleNode[];
      setSteps(children.map((c) => ({
        name: c.name, model: c.model, system: c.system ?? "", mode: c.systemMode,
      })));
    } else if (root?.type === "jury") {
      const j = root as JuryNode;
      setKind("jury");
      setPanel(j.panel.length ? [...j.panel] : ["", ""]);
      setJudge(j.judge);
      setCriteria(j.criteria.join(", "));
      setJurySystem(j.system ?? "");
    }
  }

  async function refresh() {
    const { items } = await apiGet<{ items: Graph[] }>("/api/graphs");
    s.setGraphs(items);
  }

  const emptyNode = {
    skills: [] as string[], memory: { soul: null, facts: [] as string[] },
    tools: [] as string[], inputs: [] as string[], outputs: [] as string[],
  };

  async function save() {
    if (!name.trim()) return;
    const gid = sel ?? nanoid(12);
    let nodes: Graph["nodes"];

    if (kind === "pipeline") {
      const valid = steps.filter((st) => st.model.trim());
      if (!valid.length) { alert("pipeline needs at least one step with a model"); return; }
      const children: SingleNode[] = valid.map((st, i) => ({
        ...emptyNode, id: `${gid}-s${i}`, type: "single",
        name: st.name.trim() || `step ${i + 1}`,
        model: st.model.trim(), systemMode: st.mode,
        system: st.system.trim() || undefined,
      })) as SingleNode[];
      const root: PipelineNode = {
        ...emptyNode, id: `${gid}-root`, type: "pipeline", name,
        systemMode: "append", steps: children.map((c) => c.id),
      } as PipelineNode;
      nodes = [root, ...children];
    } else {
      const models = panel.map((p) => p.trim()).filter(Boolean);
      if (models.length < 2 || !judge.trim()) { alert("jury needs ≥2 panel models and a judge"); return; }
      const root: JuryNode = {
        ...emptyNode, id: `${gid}-root`, type: "jury", name,
        systemMode: "append", system: jurySystem.trim() || undefined,
        panel: models, judge: judge.trim(),
        criteria: criteria.split(",").map((x) => x.trim()).filter(Boolean),
      } as JuryNode;
      nodes = [root];
    }

    const g = { id: gid, name, nodes, edges: [] };
    if (sel) await apiPut(`/api/graphs/${gid}`, g);
    else { await apiPost("/api/graphs", g); setSel(gid); }
    await refresh();
  }

  async function remove() {
    if (!sel || !confirm("Delete this node graph?")) return;
    await apiDelete(`/api/graphs/${sel}`);
    openNew();
    await refresh();
  }

    async function run() {
    if (!sel || !input.trim() || running) return;
    const g = s.graphs.find((x) => x.id === sel);
    const rootId = g?.nodes[0]?.id;
    const nodeName = (id: string) => g?.nodes.find((n) => n.id === id)?.name ?? id;
    setLog([]); setRunning(true);
    const add = (e: LogEntry) => setLog((l) => [...l, e]);
    try {
      await streamEvents("/api/graph/run", { graphId: sel, input }, (ev) => {
        if (ev.type === "node_start") add({ kind: "start", title: nodeName(ev.nodeId) });
        else if (ev.type === "node_done") add({
          kind: ev.nodeId === rootId ? "final" : "output",
          title: nodeName(ev.nodeId),
          body: ev.output,
        });
        else if (ev.type === "usage") add({
          kind: "usage",
          body: `${ev.usage.model} · ${ev.usage.promptTokens}→${ev.usage.completionTokens} tok · $${ev.usage.costUsd.toFixed(5)}`,
        });
        else if (ev.type === "error") add({ kind: "error", body: ev.message });
        else if (ev.type === "done") add({ kind: "done" });
      });
    } catch (e: any) {
      add({ kind: "error", body: String(e?.message ?? e) });
    } finally {
      setRunning(false);
    }
  }


  return (
    <main className="panel">
      <div className="panel-list">
        <button className="btn btn-block" onClick={openNew}>+ new graph</button>
        {s.graphs.map((g) => (
          <div key={g.id} className={g.id === sel ? "item active" : "item"} onClick={() => open(g)}>
            <div className="item-main">
              <div>{g.nodes[0]?.type === "jury" ? "⚖️" : "⛓️"} {g.name}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="panel-editor">
        <h3>{sel ? "Edit graph" : "New graph"}</h3>
        <div className="mode-toggle">
          {(["pipeline", "jury"] as const).map((k) => (
            <button key={k} className={kind === k ? "mode active" : "mode"}
              onClick={() => setKind(k)} disabled={!!sel}>{k}</button>
          ))}
        </div>
        <input placeholder="graph name" value={name} onChange={(e) => setName(e.target.value)} />

        {kind === "pipeline" ? (
          <>
            {steps.map((st, i) => (
              <div key={i} className="step-card">
                <div className="step-head">
                  <span className="muted">step {i + 1}</span>
                  <button className="btn-ghost" onClick={() => setSteps(steps.filter((_, x) => x !== i))}>✕</button>
                </div>
                <input placeholder="step name" value={st.name}
                  onChange={(e) => setSteps(steps.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x))} />
                <input list="models" placeholder="model" value={st.model} spellCheck={false}
                  onChange={(e) => setSteps(steps.map((x, xi) => xi === i ? { ...x, model: e.target.value } : x))} />
                <div className="mode-toggle">
                  {(["append", "replace"] as const).map((m) => (
                    <button key={m} className={st.mode === m ? "mode active" : "mode"}
                      onClick={() => setSteps(steps.map((x, xi) => xi === i ? { ...x, mode: m } : x))}>{m}</button>
                  ))}
                </div>
                <textarea rows={3} placeholder="system instructions for this step"
                  value={st.system}
                  onChange={(e) => setSteps(steps.map((x, xi) => xi === i ? { ...x, system: e.target.value } : x))} />
              </div>
            ))}
            <button className="btn-ghost" onClick={() => setSteps([...steps, { ...STEP }])}>+ add step</button>
          </>
        ) : (
          <>
            <h3>Panel models (answer in parallel)</h3>
            {panel.map((p, i) => (
              <div key={i} className="row-btns">
                <input list="models" placeholder={`panel model ${i + 1}`} value={p} spellCheck={false}
                  onChange={(e) => setPanel(panel.map((x, xi) => xi === i ? e.target.value : x))} />
                <button className="btn-ghost" onClick={() => setPanel(panel.filter((_, x) => x !== i))}>✕</button>
              </div>
            ))}
            <button className="btn-ghost" onClick={() => setPanel([...panel, ""])}>+ add model</button>
            <h3>Judge model</h3>
            <input list="models" placeholder="judge model" value={judge} spellCheck={false}
              onChange={(e) => setJudge(e.target.value)} />
            <h3>Criteria (comma-separated)</h3>
            <input value={criteria} onChange={(e) => setCriteria(e.target.value)} />
            <h3>System (optional, for panel)</h3>
            <textarea rows={3} value={jurySystem} onChange={(e) => setJurySystem(e.target.value)} />
          </>
        )}

        <div className="row-btns">
          <button className="btn" onClick={save}>save</button>
          {sel && <button className="btn btn-stop" onClick={remove}>delete</button>}
        </div>

        {sel && (
          <>
            <h3>Run</h3>
            <textarea rows={3} placeholder="input for the graph" value={input}
              onChange={(e) => setInput(e.target.value)} />
            <button className="btn" onClick={run} disabled={running}>
              {running ? "running…" : "run ▶"}
            </button>
            {log.length > 0 && (
              <div className="run-log2">
                {log.map((e, i) => {
                  if (e.kind === "start") return <div key={i} className="rl-start">▶ {e.title}…</div>;
                  if (e.kind === "usage") return <div key={i} className="rl-usage">{e.body}</div>;
                  if (e.kind === "error") return <div key={i} className="rl-error">✗ {e.body}</div>;
                  if (e.kind === "done") return <div key={i} className="rl-done">— done —</div>;
                  return (
                    <div key={i} className={e.kind === "final" ? "rl-card rl-final" : "rl-card"}>
                      <div className="rl-card-head">
                        {e.kind === "final" ? "★ " : "✓ "}{e.title}
                        <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(e.body ?? "")}>copy</button>
                      </div>
                      <pre className="rl-card-body">{e.body?.trim() ? e.body : "(empty output)"}</pre>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
