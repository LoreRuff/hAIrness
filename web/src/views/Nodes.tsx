import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow,
  type Edge, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore, effortsFor } from "../lib/store";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import { streamEvents } from "../lib/sse";
import { nanoid } from "nanoid";
// Same helpers the server runner uses: the canvas cannot accept a graph the
// runner would refuse (cycles), and legacy rows normalize identically.
import { normalizeGraph, topoOrder } from "../../../shared/graph.ts";
import { notify } from "../lib/notify";
import GenerateModal from "../components/GenerateModal";
import RunPanel, { type RunRecord, type PendingHuman } from "../components/RunPanel";
import ModelPicker from "../components/ModelPicker";
import Sec from "../components/Sec";
import type {
  AgentNode, BenchmarkCase, CuratorNode, Graph, HumanNode, JuryNode, LogEntry, SingleNode, SystemMode, ToolName, ToolNode,
} from "../types";

type RunState = "idle" | "running" | "done";
type CardData = { agent: AgentNode; state: RunState };
type AgentRFNode = Node<CardData, "agent">;

const emptyNode = {
  skills: [] as string[], memory: { soul: null, facts: [] as string[] },
  tools: [] as ToolName[], inputs: [] as string[], outputs: [] as string[],
};

function mkSingle(name: string, model: string, x?: number, y?: number): SingleNode {
  return {
    ...emptyNode, id: nanoid(8), type: "single", name, systemMode: "append", model,
    ...(x !== undefined ? { position: { x, y: y ?? 0 } } : {}),
  };
}

function mkJury(name: string, winnerOnly: boolean, x?: number, y?: number): JuryNode {
  return {
    ...emptyNode, id: nanoid(8), type: "jury", name, systemMode: "append",
    panel: ["", ""], judge: "", criteria: ["accuracy", "clarity"], winnerOnly,
    ...(x !== undefined ? { position: { x, y: y ?? 0 } } : {}),
  };
}

function mkCurator(name: string, x?: number, y?: number): CuratorNode {
  return {
    ...emptyNode, id: nanoid(8), type: "curator", name, systemMode: "append",
    model: "", criteria: ["relevance", "correctness"], mode: "filter",
    ...(x !== undefined ? { position: { x, y: y ?? 0 } } : {}),
  };
}

function mkTool(name: string, x?: number, y?: number): ToolNode {
  return {
    ...emptyNode, id: nanoid(8), type: "tool", name, systemMode: "append",
    tool: "web_search", args: { query: "" },
    ...(x !== undefined ? { position: { x, y: y ?? 0 } } : {}),
  };
}

function mkHuman(name: string, x?: number, y?: number): HumanNode {
  return {
    ...emptyNode, id: nanoid(8), type: "human", name, systemMode: "append",
    prompt: "Serve il tuo input per continuare:", varName: "answer",
    ...(x !== undefined ? { position: { x, y: y ?? 0 } } : {}),
  };
}

// R-A: card collapse lives outside the graph state on purpose — it is a
// per-node view preference, not data. One localStorage key holds every id so
// re-renders never fight the graph store.
const GND_COLLAPSED_KEY = "harness_gnda_collapsed";
function collapsedIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(GND_COLLAPSED_KEY) ?? "[]") as string[]); }
  catch { return new Set(); }
}
function persistCollapsed(ids: Set<string>): void {
  localStorage.setItem(GND_COLLAPSED_KEY, JSON.stringify([...ids]));
}

function AgentCard({ data, id }: NodeProps<AgentRFNode>) {
  const a = data.agent;
  const [collapsed, setCollapsed] = useState(() => collapsedIds().has(id));
  const toggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation(); // click on the head toggles, it must not move/select the node
    const next = !collapsed;
    setCollapsed(next);
    const ids = collapsedIds();
    if (next) ids.add(id); else ids.delete(id);
    persistCollapsed(ids);
  };
  const meta =
    a.type === "single" ? (a as SingleNode).model
    : a.type === "jury"
      ? `${(a as JuryNode).panel.length} models · judge: ${(a as JuryNode).judge || "—"}`
    : a.type === "curator"
      ? `${(a as CuratorNode).model || "—"} · ${(a as CuratorNode).mode}`
    : a.type === "tool"
      ? `${(a as ToolNode).tool}`
    : a.type === "human"
      ? `var.${(a as HumanNode).varName}`
      : `⚠️ ${a.type} — not runnable`;
  const icon =
    a.type === "jury" ? "⚖️" : a.type === "single" ? "💬"
    : a.type === "curator" ? "🧹" : a.type === "tool" ? "🔧"
    : a.type === "human" ? "🙋" : "🧩";
  return (
    <div className={`gnda ${data.state}${collapsed ? " collapsed" : ""}`}>
      <div className="gnda-head" onClick={toggleCollapse}>
        <span className="gnda-caret">{collapsed ? "▸" : "▾"}</span> {icon} {a.name}
      </div>
      {!collapsed && <>
        <div className="gnda-meta">{meta}</div>
        <div className="gnda-chips">
          <span className="gnda-chip">{a.systemMode}</span>
          {(a.promptIds?.length ?? 0) > 0 &&
            <span className="gnda-chip">📜 {a.promptIds!.length}</span>}
        </div>
      </>}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { agent: AgentCard };

export default function Nodes() {
  const s = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [nodes, setNodes] = useState<AgentNode[]>([]);
  const [edges, setEdges] = useState<{ from: string; to: string }[]>([]);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [genOpen, setGenOpen] = useState<null | "node" | "graph">(null);

  const [input, setInput] = useState("");
  const [runVars, setRunVars] = useState<{ key: string; value: string }[]>([]);
  const [humanAnswer, setHumanAnswer] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  // Merged log across run+resume streams (same record, same run id).
  const logRef = useRef<LogEntry[]>([]);
  const [pending, setPending] = useState<PendingHuman | null>(null);
  const [cases, setCases] = useState<BenchmarkCase[]>([]);
  const [benchBusy, setBenchBusy] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [nodeState, setNodeState] = useState<Record<string, RunState>>({});

  // Right-side panels: node config inspector (closable). The run inspector is
  // a bottom sheet over the canvas, opened from the strip (owner layout); it
  // auto-opens when a run starts or a human pause arrives.
  const [runOpen, setRunOpen] = useState(() => localStorage.getItem("harness_runpanel_open") !== "0");
  const [inspOpen, setInspOpen] = useState(() => localStorage.getItem("harness_nodeinsp_open") !== "0");
  const toggleInsp = (v: boolean) => { setInspOpen(v); localStorage.setItem("harness_nodeinsp_open", v ? "1" : "0"); };

  const touch = () => setDirty(true);

  async function refresh() {
    const { items } = await apiGet<{ items: Graph[] }>("/api/graphs");
    s.setGraphs(items);
  }

  async function refreshRuns(gid: string) {
    const { items } = await apiGet<{ items: RunRecord[] }>("/api/runs").catch(() => ({ items: [] as RunRecord[] }));
    setRuns(items.filter((r) => r.graphId === gid));
  }

  function open(g: Graph) {
    if (dirty && !confirm("discard unsaved changes?")) return;
    const n = normalizeGraph(g);
    setSel(g.id); setName(g.name); setProjectId(g.projectId);
    setNodes(n.nodes); setEdges(n.edges ?? []);
    setSelNode(null); setDirty(false); setLog([]); setNodeState({}); setPending(null);
    logRef.current = [];
    void refreshRuns(g.id);
    void refreshPendingSoon(g.id);
    void refreshCases(g.id);
  }

  // refreshPending depends on `sel` state; pass the id explicitly on open.
  async function refreshPendingSoon(gid: string) {
    const { items } = await apiGet<{ items: (PendingHuman & { graphId: string })[] }>("/api/graph/pending")
      .catch(() => ({ items: [] as (PendingHuman & { graphId: string })[] }));
    const mine = items.find((p) => p.graphId === gid);
    setPending(mine ? { runId: mine.runId, nodeId: mine.nodeId, prompt: mine.prompt, varName: mine.varName } : null);
  }

  // Ctrl+K palette jump: someone picked this graph from anywhere.
  useEffect(() => {
    const g = s.graphs.find((x) => x.id === s.focusGraphId);
    if (!g) return;
    open(g);
    s.setFocusGraphId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.focusGraphId]);

  function openNew(tpl: "blank" | "chain" | "jury" | "refine") {
    if (dirty && !confirm("discard unsaved changes?")) return;
    setSel(null); setName(""); setProjectId(undefined);
    setSelNode(null); setDirty(false); setLog([]); setNodeState({}); setRuns([]); setCases([]); setPending(null);
    if (tpl === "chain") {
      const a = mkSingle("draft", "", 0, 0);
      const b = mkSingle("review", "", 320, 0);
      const c = mkSingle("final", "", 640, 0);
      setNodes([a, b, c]);
      setEdges([{ from: a.id, to: b.id }, { from: b.id, to: c.id }]);
    } else if (tpl === "jury") {
      setNodes([mkJury("jury", false, 0, 0)]); setEdges([]);
    } else if (tpl === "refine") {
      const j = mkJury("jury", true, 0, 0);
      const r = mkSingle("refine", "", 320, 0);
      setNodes([j, r]); setEdges([{ from: j.id, to: r.id }]);
    } else {
      setNodes([]); setEdges([]);
    }
  }

  function updateNode(id: string, patch: Record<string, unknown>) {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } as AgentNode : n)));
    touch();
  }

  function addNode(type: "single" | "jury" | "curator" | "tool" | "human") {
    const label = nodes.length + 1;
    const n =
      type === "single" ? mkSingle(`node ${label}`, "")
      : type === "jury" ? mkJury(`jury ${label}`, false)
      : type === "curator" ? mkCurator(`curator ${label}`)
      : type === "tool" ? mkTool(`tool ${label}`)
      : mkHuman(`input ${label}`);
    setNodes([...nodes, n]);
    setSelNode(n.id);
    touch();
  }

  function deleteNode(id: string) {
    setNodes(nodes.filter((n) => n.id !== id));
    setEdges(edges.filter((e) => e.from !== id && e.to !== id));
    if (selNode === id) setSelNode(null);
    touch();
  }

  // The runner throws on cycles, so the canvas uses the same test at
  // connect time: a graph that cannot run can never be saved.
  function connect(from: string, to: string) {
    if (from === to) return;
    if (edges.some((e) => e.from === from && e.to === to)) return;
    try {
      topoOrder(nodes, [...edges, { from, to }]);
    } catch (e: any) {
      alert(e?.message ?? "this edge would create a cycle");
      return;
    }
    setEdges([...edges, { from, to }]);
    touch();
  }

  function removeEdges(list: { from: string; to: string }[]) {
    setEdges(edges.filter((e) => !list.some((x) => x.from === e.from && x.to === e.to)));
    touch();
  }

  // Generator apply paths: both accept the (already server-validated)
  // proposal as the user may have edited it; ids/positions come pre-assigned.
  function applyGeneratedNode(n: AgentNode) {
    const count = nodes.length;
    if (!n.position) n.position = { x: (count % 4) * 300, y: Math.floor(count / 4) * 150 };
    setNodes((ns) => [...ns, n]);
    setSelNode(n.id);
    touch();
  }

  function applyGeneratedGraph(g: { name: string; nodes: AgentNode[]; edges: { from: string; to: string }[] }) {
    if (dirty && !confirm("replace the current canvas with the generated graph?")) return;
    setSel(null);
    setName(g.name || "generated graph");
    setNodes(g.nodes);
    setEdges(g.edges);
    setSelNode(null);
    touch();
  }

  function move(id: string, pos: { x: number; y: number }) {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, position: pos } : n)));
    touch();
  }

  async function save(): Promise<boolean> {
    if (!name.trim()) { alert("graph needs a name"); return false; }
    for (const n of nodes) {
      if (n.type === "single" && !(n as SingleNode).model.trim()) {
        alert(`node "${n.name}": pick a model`); return false;
      }
      if (n.type === "jury") {
        const j = n as JuryNode;
        if (j.panel.filter(Boolean).length < 2 || !j.judge.trim()) {
          alert(`jury "${n.name}": needs ≥2 panel models and a judge`); return false;
        }
      }
      if (n.type === "curator" && !(n as CuratorNode).model.trim()) {
        alert(`curator "${n.name}": pick a model`); return false;
      }
      if (n.type === "tool") {
        const t = n as ToolNode;
        // The query may come from a template, so placeholders count as set.
        const q = (t.args.query ?? "").trim();
        if (!q || (!q.includes("{{") && !q.replace(/\{\{[^}]*\}\}/g, "").trim() && q.length < 3)) {
          alert(`tool "${n.name}": set args.query (text or {{var}})`); return false;
        }
      }
      if (n.type === "human" && !/^[a-zA-Z0-9_]+$/.test((n as HumanNode).varName || "")) {
        alert(`human node "${n.name}": varName must be alphanumeric/underscore`); return false;
      }
    }
    const gid = sel ?? nanoid(12);
    const g = { id: gid, name: name.trim(), projectId, nodes, edges };
    if (sel) await apiPut(`/api/graphs/${gid}`, g);
    else { await apiPost("/api/graphs", g); setSel(gid); }
    await refresh();
    setDirty(false);
    return true;
  }

  async function remove() {
    if (!sel || !confirm("Delete this node graph?")) return;
    await apiDelete(`/api/graphs/${sel}`);
    openNew("blank");
    await refresh();
  }

  // Shared SSE consumer for run, resume and benchmark execution: same log
  // structure, same node coloring. quiet=true (benchmarks) renders nothing
  // and answers nothing — it just records. Returns the sink outputs so the
  // caller can persist them without re-parsing the log.
  async function consumeStream(
    path: string, payload: unknown, gid: string, collect: LogEntry[], quiet = false
  ): Promise<{ finals: string[] }> {
    const g = s.graphs.find((x) => x.id === gid);
    const nameOf = (id: string) => g?.nodes.find((n) => n.id === id)?.name ?? id;
    // Sinks carry the graph's final answer (same rule as the runner): a
    // multi-branch graph shows one final card per sink.
    const sinks = new Set(
      (g?.nodes ?? []).filter((n) => !(g?.edges ?? []).some((e) => e.from === n.id)).map((n) => n.id)
    );
    const finals: string[] = [];
    const add = (e: LogEntry) => { collect.push({ ...e, at: Date.now() }); if (!quiet) setLog((l) => [...l, e]); };
    try {
      await streamEvents(path, payload, (ev) => {
        if (ev.type === "node_start") {
          if (!quiet) setNodeState((m) => ({ ...m, [ev.nodeId]: "running" }));
          add({ kind: "start", title: nameOf(ev.nodeId) });
        } else if (ev.type === "node_done") {
          if (!quiet) setNodeState((m) => ({ ...m, [ev.nodeId]: "done" }));
          const kind = sinks.has(ev.nodeId) ? "final" : "output";
          if (kind === "final") finals.push(ev.output);
          add({ kind, title: nameOf(ev.nodeId), body: ev.output });
        } else if (ev.type === "human_input_required") {
          add({ kind: "human", title: nameOf(ev.nodeId), body: ev.prompt });
          if (!quiet) {
            const nodeName = nameOf(ev.nodeId);
            setPending({ runId: ev.runId, nodeId: ev.nodeId, prompt: ev.prompt, varName: ev.varName });
            const msg = `Il nodo "${nodeName}" attende il tuo input`;
            s.setToast(msg);
            notify("hAIrness — input richiesto", msg);
          }
        } else if (ev.type === "usage") {
          add({
            kind: "usage",
            body: `${ev.usage.model} · ${ev.usage.promptTokens}→${ev.usage.completionTokens} tok · $${ev.usage.costUsd.toFixed(5)}`,
          });
        } else if (ev.type === "error") {
          add({ kind: "error", body: ev.message });
        } else if (ev.type === "done") {
          add({ kind: "done" });
        }
      });
    } catch (e: any) {
      add({ kind: "error", body: String(e?.message ?? e) });
    }
    return { finals };
  }

  async function run() {
    if (!sel || running || !input.trim()) return;
    if (dirty) { if (!(await save())) return; }
    const rid = nanoid(12);
    const collect: LogEntry[] = (logRef.current = []);
    setLog([]); setRunning(true); setNodeState({}); setPending(null);
    setRunOpen(true);
    const vars = Object.fromEntries(
      runVars.filter((v) => v.key.trim()).map((v) => [v.key.trim(), v.value])
    );
    await consumeStream("/api/graph/run", { graphId: sel, input, vars, runId: rid }, sel, collect);
    setRunning(false);
    // persist the run so it survives reloads, backups, snapshots and sync;
    // a resumed continuation re-POSTs the same id and upserts the merged log
    await apiPost("/api/runs", { id: rid, graphId: sel, input, log: collect }).catch(() => {});
    if (sel) await refreshRuns(sel);
    await refreshPending();
  }

  async function resume(value: string) {
    if (!pending || running || !sel) return;
    setRunning(true);
    setRunOpen(true);
    // continue into the SAME log (merged record, same run id on upsert)
    const collect = logRef.current;
    setNodeState((m) => ({ ...m, [pending.nodeId]: "done" }));
    await consumeStream("/api/graph/resume", { runId: pending.runId, value }, sel, collect);
    setRunning(false);
    setPending(null);
    await apiPost("/api/runs", { id: pending.runId, graphId: sel, input, log: collect }).catch(() => {});
    if (sel) await refreshRuns(sel);
    await refreshPending();
  }

  // Pauses that happened elsewhere (other tab, page reload) still surface.
  async function refreshPending() {
    if (!sel) { setPending(null); return; }
    const { items } = await apiGet<{ items: (PendingHuman & { graphId: string })[] }>("/api/graph/pending")
      .catch(() => ({ items: [] }));
    const mine = items.find((p) => p.graphId === sel);
    setPending(mine ? { runId: mine.runId, nodeId: mine.nodeId, prompt: mine.prompt, varName: mine.varName } : null);
  }

  async function discardPending() {
    if (!pending) return;
    await apiDelete(`/api/graph/pending/${pending.runId}`).catch(() => {});
    setPending(null);
  }

  async function deleteRun(id: string) {
    await apiDelete(`/api/runs/${id}`);
    if (sel) await refreshRuns(sel);
  }

  /* ---------- P3: benchmark seed + run-all ---------- */

  async function refreshCases(gid: string) {
    const { items } = await apiGet<{ items: BenchmarkCase[] }>("/api/benchmarks").catch(() => ({ items: [] as BenchmarkCase[] }));
    setCases(items.filter((cs) => cs.graphId === gid));
  }

  async function seedCase(r: RunRecord) {
    if (!sel) return;
    await apiPost("/api/benchmarks", {
      graphId: sel, name: r.input.slice(0, 40) || "case", input: r.input,
    }).catch(() => {});
    await refreshCases(sel);
  }

  async function deleteCase(id: string) {
    await apiDelete(`/api/benchmarks/${id}`);
    if (sel) await refreshCases(sel);
  }

  // Sequential by design: the LXC has room for one inference at a time and
  // benchmark numbers must be comparable across cases (no load interference).
  async function runBenchmarks() {
    if (!sel || benchBusy || running || !cases.length) return;
    setBenchBusy(true);
    for (const cs of cases) {
      const entries: LogEntry[] = [];
      const t0 = Date.now();
      const { finals } = await consumeStream(
        "/api/graph/run", { graphId: sel, input: cs.input, vars: {}, runId: nanoid(12) }, sel, entries, true
      );
      const errs = entries.filter((e) => e.kind === "error").map((e) => e.body).join("; ");
      await apiPut(`/api/benchmarks/${cs.id}`, {
        ...cs, lastRun: {
          at: Date.now(), durationMs: Date.now() - t0,
          ...(finals.length ? { output: finals.join("\n\n---\n\n") } : {}),
          ...(errs ? { error: errs } : {}),
        },
      }).catch(() => {});
    }
    setBenchBusy(false);
    await refreshCases(sel);
  }

  // Stable identities: new objects on every render would make React Flow
  // re-render the whole canvas and fight the drag transform (RDP-style lag).
  const rfNodes: AgentRFNode[] = useMemo(() => nodes.map((n, i) => ({
    id: n.id,
    type: "agent",
    position: n.position ?? { x: (i % 4) * 300, y: Math.floor(i / 4) * 150 },
    data: { agent: n, state: nodeState[n.id] ?? "idle" },
  })), [nodes, nodeState]);
  const rfEdges: Edge[] = useMemo(() => edges.map((e) => ({
    id: `${e.from}→${e.to}`,
    source: e.from,
    target: e.to,
    markerEnd: { type: MarkerType.ArrowClosed },
  })), [edges]);

  const selAgent = nodes.find((n) => n.id === selNode) ?? null;

  function renderPersonas(n: AgentNode) {
    return (
      <>
        <div className="picker-head">Personas</div>
        {s.prompts.length === 0 && <div className="muted">none — create in Prompts</div>}
        {s.prompts.map((p) => {
          const on = (n.promptIds ?? []).includes(p.id);
          return (
            <div key={p.id} className={on ? "pick on" : "pick"}
              onClick={() => updateNode(n.id, {
                promptIds: on
                  ? (n.promptIds ?? []).filter((x) => x !== p.id)
                  : [...(n.promptIds ?? []), p.id],
              })}>
              📜 {p.name}
            </div>
          );
        })}
      </>
    );
  }

  return (
    <main className={"node-view" + (inspOpen ? " ni" : "")}>
      <div className="panel-list">
        <div className="newwrap">
          <button className="btn btn-block" onClick={() => setTplOpen(!tplOpen)}>+ new graph</button>
          {tplOpen && (
            <div className="picker">
              <div className="pick" onClick={() => { openNew("blank"); setTplOpen(false); }}>blank canvas</div>
              <div className="pick" onClick={() => { openNew("chain"); setTplOpen(false); }}>⛓️ chain — 3 single A→B→C</div>
              <div className="pick" onClick={() => { openNew("jury"); setTplOpen(false); }}>⚖️ jury — panel + judge</div>
              <div className="pick" onClick={() => { openNew("refine"); setTplOpen(false); }}>⚖️➡️💬 jury → refine</div>
            </div>
          )}
        </div>
        {s.graphs.map((g) => (
          <div key={g.id} className={g.id === sel ? "item active" : "item"} onClick={() => open(g)}>
            <div className="item-main">
              <div>{g.nodes[0]?.type === "jury" ? "⚖️" : "🕸️"} {g.name}</div>
              <div className="muted item-sub">{g.nodes?.length ?? 0} nodes · {g.edges?.length ?? 0} edges</div>
            </div>
          </div>
        ))}
      </div>

      <div className="node-canvas-wrap">
        <div className="node-canvas-head">
          <input className="graph-name" placeholder="graph name" value={name}
            onChange={(e) => { setName(e.target.value); touch(); }} />
          {dirty && <span className="dirty-dot" title="unsaved changes">●</span>}
          <button className="btn-ghost" onClick={() => addNode("single")}>+ 💬 single</button>
          <button className="btn-ghost" onClick={() => addNode("jury")}>+ ⚖️ jury</button>
          <button className="btn-ghost" onClick={() => addNode("curator")}>+ 🧹 curator</button>
          <button className="btn-ghost" onClick={() => addNode("tool")}>+ 🔧 tool</button>
          <button className="btn-ghost" onClick={() => addNode("human")}>+ 🙋 human</button>
          <span className="spacer" />
          <button className="btn-ghost" onClick={() => setGenOpen("node")}>✨ node</button>
          <button className="btn-ghost" onClick={() => setGenOpen("graph")}>✨ graph</button>
          <span className="spacer" />
          <button className={inspOpen ? "btn-ghost nv-toggle on" : "btn-ghost nv-toggle"}
            title="node config" onClick={() => toggleInsp(!inspOpen)}>⚙</button>
          <button className="btn" onClick={() => void save()} disabled={!dirty && !!sel}>save</button>
          {sel && <button className="btn btn-stop" onClick={remove}>delete</button>}
        </div>
        {/* key by graph id: switching graphs remounts the canvas so fitView starts fresh */}
        <div className="node-canvas-body">
          <ReactFlow
            key={sel ?? "new"}
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, n) => setSelNode(n.id)}
            onPaneClick={() => setSelNode(null)}
            // Live drag: apply position changes as they stream in, so the node
            // follows the pointer every frame instead of snapping on drop.
            onNodesChange={(changes) => {
              if (!changes.some((c) => c.type === "position")) return;
              setNodes((ns) => ns.map((n) => {
                const c = changes.find((x) => x.type === "position" && x.id === n.id);
                return c && c.type === "position" && c.position
                  ? { ...n, position: c.position }
                  : n;
              }));
            }}
            onNodeDragStop={(_, n) => move(n.id, n.position)}
            onConnect={(c) => connect(c.source, c.target)}
            onNodesDelete={(nds) => {
              const ids = nds.map((n) => n.id);
              setNodes(nodes.filter((n) => !ids.includes(n.id)));
              setEdges(edges.filter((e) => !ids.includes(e.from) && !ids.includes(e.to)));
              touch();
            }}
            onEdgesDelete={(eds) => removeEdges(eds.map((e) => ({ from: e.source, to: e.target })))}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {/* Run inspector: strip + bottom sheet, in front of the canvas
            (owner layout) — inside the wrap so it overlays only the graph. */}
        <RunPanel
          open={runOpen}
          onToggle={setRunOpen}
          saved={!!sel}
          input={input} setInput={setInput}
          runVars={runVars} setRunVars={setRunVars}
          running={running}
          onRun={() => void run()}
          pending={pending}
          humanAnswer={humanAnswer} setHumanAnswer={setHumanAnswer}
          onResume={(v) => { setHumanAnswer(""); void resume(v); }}
          onDiscardPending={() => void discardPending()}
          log={log}
          runs={runs}
          onSeedCase={(r) => void seedCase(r)}
          onDeleteRun={(id) => void deleteRun(id)}
          showCompare={showCompare} setShowCompare={setShowCompare}
          cases={cases}
          onDeleteCase={(id) => void deleteCase(id)}
          onRunBenchmarks={() => void runBenchmarks()}
          benchBusy={benchBusy}
        />
      </div>

      {genOpen && (
        <GenerateModal
          mode={genOpen}
          graphId={sel}
          models={s.models.map((m) => m.id)}
          defaultModel={s.model}
          onClose={() => setGenOpen(null)}
          onApplyNode={applyGeneratedNode}
          onApplyGraph={applyGeneratedGraph}
        />
      )}

      {inspOpen && (
        <div className="node-inspector">
          <h3>Config</h3>
          {!selAgent && <div className="muted">select a node on the canvas</div>}
        {selAgent && (
          <>
            <input value={selAgent.name}
              onChange={(e) => updateNode(selAgent.id, { name: e.target.value })} />
            <div className="mode-toggle">
              {(["append", "replace"] as const).map((m) => (
                <button key={m} className={selAgent.systemMode === m ? "mode active" : "mode"}
                  onClick={() => updateNode(selAgent.id, { systemMode: m })}>{m}</button>
              ))}
            </div>

            {selAgent.type === "single" && (
              <>
                <ModelPicker value={(selAgent as SingleNode).model}
                  onChange={(m) => updateNode(selAgent.id, { model: m })} />
                <textarea rows={5} placeholder="system instructions for this node"
                  value={selAgent.system ?? ""}
                  onChange={(e) => updateNode(selAgent.id, { system: e.target.value })} />
              </>
            )}

            {/* Per-node run overrides (N5): only for node types whose runner
             * actually reads them — single/jury/curator. Hidden elsewhere so
             * no dead knobs. contextWindow is chat-only by design: node calls
             * are single-shot, there is no history to slice. */}
            {["single", "jury", "curator"].includes(selAgent.type) && (() => {
              const anyN = selAgent as { model?: string; judge?: string; panel?: string[] };
              const pm = anyN.model || anyN.judge || anyN.panel?.[0] || "";
              return (
                <>
                  <Sec title="Temperature" val={(selAgent.temperature ?? 0.7).toFixed(1)}>
                    <input type="range" min={0} max={2} step={0.1} value={selAgent.temperature ?? 0.7}
                      onChange={(e) => updateNode(selAgent.id, { temperature: Number(e.target.value) })} />
                  </Sec>
                  <Sec title="Reasoning effort" val={selAgent.reasoning || "default"}>
                    <select value={selAgent.reasoning ?? ""}
                      onChange={(e) => updateNode(selAgent.id, { reasoning: e.target.value || undefined })}>
                      <option value="">default (no effort hint)</option>
                      {effortsFor(s.models, pm).map((ef) => <option key={ef} value={ef}>{ef}</option>)}
                    </select>
                  </Sec>
                </>
              );
            })()}

            {selAgent.type === "jury" && (() => {
              const j = selAgent as JuryNode;
              return (
                <>
                  <h3>Panel models (answer in parallel)</h3>
                  {j.panel.map((p, pi) => (
                    <div key={pi} className="row-btns">
                      <ModelPicker value={p}
                        onChange={(m) => updateNode(j.id, { panel: j.panel.map((x, xi) => (xi === pi ? m : x)) })} />
                      <button className="btn-ghost"
                        onClick={() => updateNode(j.id, { panel: j.panel.filter((_, xi) => xi !== pi) })}>✕</button>
                    </div>
                  ))}
                  <button className="btn-ghost" onClick={() => updateNode(j.id, { panel: [...j.panel, ""] })}>+ add model</button>
                  <h3>Judge model</h3>
                  <ModelPicker value={j.judge} onChange={(m) => updateNode(j.id, { judge: m })} />
                  <h3>Criteria (comma-separated)</h3>
                  <input value={j.criteria.join(", ")}
                    onChange={(e) => updateNode(j.id, {
                      criteria: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
                    })} />
                  <h3>System (optional, for panel)</h3>
                  <textarea rows={3} value={j.system ?? ""}
                    onChange={(e) => updateNode(j.id, { system: e.target.value })} />
                  <label className="ctx-item">
                    <input type="checkbox" checked={!!j.winnerOnly}
                      onChange={(e) => updateNode(j.id, { winnerOnly: e.target.checked })} />
                    output winner answer only (best when chained)
                  </label>
                </>
              );
            })()}

            {selAgent.type === "curator" && (() => {
              const cu = selAgent as CuratorNode;
              return (
                <>
                  <ModelPicker value={cu.model} onChange={(m) => updateNode(cu.id, { model: m })} />
                  <div className="mode-toggle">
                    {(["filter", "pass"] as const).map((m) => (
                      <button key={m} className={cu.mode === m ? "mode active" : "mode"}
                        onClick={() => updateNode(cu.id, { mode: m })}>{m}</button>
                    ))}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    filter: echoes the selected fragments · pass: rewrites them into one text
                  </div>
                  <h3>Criteria (comma-separated)</h3>
                  <input value={cu.criteria.join(", ")}
                    onChange={(e) => updateNode(cu.id, {
                      criteria: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
                    })} />
                  <h3>Extra instructions (optional)</h3>
                  <textarea rows={4} value={cu.system ?? ""}
                    onChange={(e) => updateNode(cu.id, { system: e.target.value })} />
                </>
              );
            })()}

            {selAgent.type === "tool" && (() => {
              const t = selAgent as ToolNode;
              const args = Object.entries(t.args);
              return (
                <>
                  <h3>Tool</h3>
                  <select value={t.tool} onChange={(e) => updateNode(t.id, { tool: e.target.value })}>
                    <option value="web_search">web_search</option>
                  </select>
                  <div className="muted" style={{ fontSize: 11 }}>
                    server-side executor · values are templates ({"{{var.key}}"})
                  </div>
                  {args.map(([k, v], i) => (
                    <div key={k} className="row-btns">
                      <input value={k} disabled />
                      <input value={v} spellCheck={false}
                        onChange={(e) => updateNode(t.id, { args: Object.fromEntries(args.map(([kk, vv], xi) => (xi === i ? [kk, e.target.value] : [kk, vv]))) })} />
                    </div>
                  ))}
                </>
              );
            })()}

            {selAgent.type === "human" && (() => {
              const h = selAgent as HumanNode;
              return (
                <>
                  <h3>Question to the user</h3>
                  <textarea rows={3} value={h.prompt}
                    onChange={(e) => updateNode(h.id, { prompt: e.target.value })} />
                  <h3>Answer variable</h3>
                  <div className="muted" style={{ fontSize: 11 }}>
                    downstream templates read it as {"{{var.<name>}}"}
                  </div>
                  <input value={h.varName} spellCheck={false}
                    onChange={(e) => updateNode(h.id, { varName: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} />
                </>
              );
            })()}

            {renderPersonas(selAgent)}

            <div className="row-btns" style={{ marginTop: 12 }}>
              <button className="btn btn-stop" onClick={() => deleteNode(selAgent.id)}>delete node</button>
            </div>
          </>
        )}
        </div>
      )}
    </main>
  );
}
