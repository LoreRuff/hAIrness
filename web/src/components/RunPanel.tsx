import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { BenchmarkCase, LogEntry } from "../types";
import RunCompare from "./RunCompare";

// Run inspector (owner layout): bottom sheet in FRONT of the canvas, opened
// from the always-visible strip. Two panes: left rail lists the runs (live
// one pinned on top, past ones read-only), right pane is the timeline of the
// selected run — grouped per node, expandable to read the full output.
// Selection is internal: opening a past run must NOT clobber the live log
// state in Nodes.tsx (the previous onOpenRun did exactly that).
export interface RunRecord { id?: string; graphId: string; input: string; log: LogEntry[]; updatedAt?: number }
export interface PendingHuman { runId: string; nodeId: string; prompt: string; varName: string }

interface RunPanelProps {
  open: boolean;
  onToggle: (v: boolean) => void;
  saved: boolean;
  input: string; setInput: (v: string) => void;
  runVars: { key: string; value: string }[]; setRunVars: (v: { key: string; value: string }[]) => void;
  running: boolean;
  onRun: () => void;
  pending: PendingHuman | null;
  humanAnswer: string; setHumanAnswer: (v: string) => void;
  onResume: (v: string) => void;
  onDiscardPending: () => void;
  log: LogEntry[];
  runs: RunRecord[];
  onSeedCase: (r: RunRecord) => void;
  onDeleteRun: (id: string) => void;
  showCompare: boolean; setShowCompare: (v: boolean) => void;
  cases: BenchmarkCase[];
  onDeleteCase: (id: string) => void;
  onRunBenchmarks: () => void;
  benchBusy: boolean;
}

// One timeline step: a start event opens it, the usage lines and the node's
// output/error/human events close it. Standalone events (done) stay alone.
interface Step {
  title: string;
  at?: number;
  usages: string[];
  body?: string;
  error?: string;
  human?: string;
  final: boolean;
}

function buildTimeline(log: LogEntry[]): { steps: (Step | { done: true })[]; t0?: number } {
  const t0 = log.find((e) => e.at)?.at;
  const steps: (Step | { done: true })[] = [];
  let cur: Step | null = null;
  const push = () => { if (cur) steps.push(cur); cur = null; };
  for (const e of log) {
    if (e.kind === "start") { push(); cur = { title: e.title ?? "node", at: e.at, usages: [], final: false }; }
    else if (e.kind === "usage") { (cur ??= { title: "model call", usages: [], final: false }).usages.push(e.body ?? ""); }
    else if (e.kind === "output" || e.kind === "final") {
      push();
      steps.push({ title: e.title ?? "node", at: e.at, usages: [], body: e.body, final: e.kind === "final" });
    } else if (e.kind === "error") {
      push();
      steps.push({ title: "error", at: e.at, usages: [], error: e.body, final: false });
    } else if (e.kind === "human") {
      push();
      steps.push({ title: e.title ?? "human", at: e.at, usages: [], human: e.body, final: false });
    } else if (e.kind === "done") { push(); steps.push({ done: true }); }
  }
  push();
  return { steps, t0 };
}

const RS_H_KEY = "harness_runsheet_h";
const RS_MIN = 160;

export default function RunPanel(p: RunPanelProps) {
  // Sheet height lives here (view preference, not run state): px so the drag
  // arithmetic stays integer; clamped against the viewport on restore too.
  const [h, setH] = useState<number>(() => {
    const v = Number(localStorage.getItem(RS_H_KEY));
    const max = window.innerHeight * 0.85;
    return Number.isFinite(v) && v >= RS_MIN ? Math.min(v, max) : Math.round(window.innerHeight * 0.55);
  });
  // Which entry the right pane shows: the live run or a past run id.
  const [sel, setSel] = useState<"current" | string>("current");
  const [railTab, setRailTab] = useState<"runs" | "bench">("runs");
  // Expanded step bodies (a final/error starts open, everything else shows
  // a one-line preview until clicked).
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // A fresh live run always steals the right pane back from history.
  useEffect(() => { if (p.running) setSel("current"); }, [p.running]);

  const current: RunRecord = { graphId: "", input: p.input, log: p.log };
  const view: RunRecord | null = sel === "current" ? current : (p.runs.find((r) => r.id === sel) ?? null);

  const { steps, t0 } = useMemo(
    () => buildTimeline(view?.log ?? []),
    [view?.log]
  );
  // Open the interesting steps by default whenever the selected run changes.
  useEffect(() => {
    const open = new Set<number>();
    steps.forEach((s, i) => { if (!("done" in s) && (s.final || s.error)) open.add(i); });
    setExpanded(open);
  }, [sel, steps.length, view?.log.length]);

  const rel = (at?: number) =>
    t0 && at ? <span className="rl-t">{((at - t0) / 1000).toFixed(1)}s</span> : null;

  const runDot = (r: RunRecord) => {
    const l = r.log ?? [];
    if (l.some((e) => e.kind === "error")) return "rs-dot err";
    if (l.some((e) => e.kind === "human")) return "rs-dot pause";
    return "rs-dot ok";
  };

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = h;
    let lastH = h;
    const onMove = (ev: MouseEvent) => {
      // dragging the top edge up grows the sheet
      lastH = Math.round(Math.min(Math.max(startH + (startY - ev.clientY), RS_MIN), window.innerHeight * 0.85));
      setH(lastH);
    };
    const onUp = () => {
      localStorage.setItem(RS_H_KEY, String(lastH));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <>
      {p.open && (
        <div className="run-sheet" style={{ "--rs-h": `${h}px` } as CSSProperties}>
          <div className="rs-resize" title="drag to resize" onMouseDown={startResize} />
          <div className="rs-body">
            {/* Left rail: run selection. */}
            <div className="rs-rail">
              <div className="rs-tabs">
                <button className={railTab === "runs" ? "on" : ""} onClick={() => setRailTab("runs")}>runs</button>
                <button className={railTab === "bench" ? "on" : ""} onClick={() => setRailTab("bench")}>bench</button>
              </div>
              {railTab === "runs" && (
                <>
                  <div className={`rs-run ${sel === "current" ? "on" : ""}`} onClick={() => setSel("current")}>
                    <span className={p.running ? "rs-dot live" : p.pending ? "rs-dot pause" : "rs-dot"} />
                    <div className="item-main">
                      <div>current run</div>
                      <div className="muted item-sub">
                        {p.running ? "running…" : p.pending ? "⏸ input needed" : p.log.length ? `${p.log.length} events` : "idle"}
                      </div>
                    </div>
                  </div>
                  {p.runs.map((r) => (
                    <div key={r.id} className={`rs-run ${sel === r.id ? "on" : ""}`} onClick={() => setSel(r.id!)}>
                      <span className={runDot(r)} />
                      <div className="item-main">
                        <div>{r.input.slice(0, 44) || "(no input)"}</div>
                        <div className="muted item-sub">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : ""}</div>
                      </div>
                      <button className="btn-ghost" title="seed benchmark case"
                        onClick={(e) => { e.stopPropagation(); p.onSeedCase(r); }}>★</button>
                      <button className="btn-ghost" title="delete run"
                        onClick={(e) => { e.stopPropagation(); if (r.id) p.onDeleteRun(r.id); }}>✕</button>
                    </div>
                  ))}
                  <div className="rs-rail-foot">
                    {p.runs.length >= 2 && (
                      <button className="btn-ghost" onClick={() => p.setShowCompare(!p.showCompare)}>
                        ⇄ compare
                      </button>
                    )}
                  </div>
                </>
              )}
              {railTab === "bench" && (
                <>
                  <div className="muted" style={{ fontSize: 11, padding: "4px 8px" }}>
                    seed cases from runs (★) · run playground = task benchmark
                  </div>
                  {p.cases.map((cs) => (
                    <div key={cs.id} className="rs-run" title={cs.input}>
                      <span className={`rs-dot ${cs.lastRun?.error ? "err" : cs.lastRun ? "ok" : ""}`} />
                      <div className="item-main">
                        <div>★ {cs.name}</div>
                        <div className="muted item-sub">
                          {cs.lastRun
                            ? cs.lastRun.error
                              ? `✗ ${cs.lastRun.error.slice(0, 40)}`
                              : `✓ ${(cs.lastRun.durationMs / 1000).toFixed(1)}s`
                            : "never run"}
                        </div>
                      </div>
                      <button className="btn-ghost" onClick={() => p.onDeleteCase(cs.id)}>✕</button>
                    </div>
                  ))}
                  {p.cases.length > 0 && (
                    <button className="btn-ghost" onClick={p.onRunBenchmarks} disabled={p.benchBusy || p.running}>
                      {p.benchBusy ? "running all…" : `run all (${p.cases.length}) ▶`}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Right pane: the selected run. */}
            <div className="rs-detail">
              {p.showCompare && p.runs.length >= 2 && (
                <RunCompare runs={p.runs.filter((r) => r.id).map((r) => ({
                  id: r.id!, label: `${r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "?"} · ${r.input.slice(0, 30)}`,
                  log: r.log ?? [],
                }))} />
              )}

              {sel === "current" && (
                <div className="rs-launch">
                  {!p.saved && <div className="muted">save the graph first, then run it here</div>}
                  {p.saved && (
                    <>
                      <textarea rows={2} placeholder="input for the graph" value={p.input}
                        onChange={(e) => p.setInput(e.target.value)} />
                      <div className="row-btns">
                        <button className="btn" onClick={p.onRun} disabled={p.running || !p.input.trim()}>
                          {p.running ? "running…" : "run ▶"}
                        </button>
                        <button className="btn-ghost" onClick={() => p.setRunVars([...p.runVars, { key: "", value: "" }])}>
                          + var
                        </button>
                      </div>
                      {p.runVars.map((v, i) => (
                        <div key={i} className="row-btns">
                          <input placeholder="key" value={v.key} spellCheck={false}
                            onChange={(e) => p.setRunVars(p.runVars.map((x, xi) => (xi === i ? { ...x, key: e.target.value } : x)))} />
                          <input placeholder="value" value={v.value} spellCheck={false}
                            onChange={(e) => p.setRunVars(p.runVars.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)))} />
                          <button className="btn-ghost"
                            onClick={() => p.setRunVars(p.runVars.filter((_, xi) => xi !== i))}>✕</button>
                        </div>
                      ))}
                      <div className="muted" style={{ fontSize: 11 }}>
                        {"{{var.key}}"} in node input/system · node outputs as {"{{node-name.output}}"}
                      </div>
                      {p.pending && (
                        <div className="human-pause">
                          <div className="hp-head">🙋 {p.pending.prompt || "input needed to continue"}</div>
                          <textarea rows={2} placeholder={`answer → var.${p.pending.varName}`} value={p.humanAnswer}
                            onChange={(e) => p.setHumanAnswer(e.target.value)} />
                          <div className="row-btns">
                            <button className="btn" disabled={p.running || !p.humanAnswer.trim()}
                              onClick={() => p.onResume(p.humanAnswer)}>
                              continue ▶
                            </button>
                            <button className="btn-ghost" onClick={p.onDiscardPending}>discard pause</button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {view && (
                <div className="rs-timeline">
                  <div className="rs-head">
                    <span className="muted">{view.input.slice(0, 80) || "(no input)"}</span>
                    <span className="muted rl-t">
                      {steps.filter((s) => !("done" in s)).length} steps
                      {steps.length && t0 && (view.log.at(-1)?.at ?? 0) > t0
                        ? ` · ${(((view.log.at(-1)?.at ?? 0) - t0) / 1000).toFixed(1)}s` : ""}
                    </span>
                  </div>
                  {steps.map((s, i) => ("done" in s ? (
                    <div key={i} className="rl-done">— done —</div>
                  ) : s.error ? (
                    <div key={i} className="rs-step err open">
                      <div className="rs-step-head" onClick={() => setExpanded((x) => toggle(x, i))}>
                        ✗ {s.title}{rel(s.at)}
                      </div>
                      <pre className="rl-card-body">{s.error}</pre>
                    </div>
                  ) : s.human !== undefined ? (
                    <div key={i} className="rs-step human open">
                      <div className="rs-step-head">⏸ {s.title}: {s.human}{rel(s.at)}</div>
                    </div>
                  ) : (
                    <div key={i} className={`rs-step ${s.final ? "final" : ""} ${expanded.has(i) ? "open" : ""}`}>
                      <div className="rs-step-head" onClick={() => setExpanded((x) => toggle(x, i))}>
                        <span className="rs-mark">{s.final ? "★" : "✓"}</span> {s.title}
                        {s.usages.map((u, ui) => <span key={ui} className="rs-usage">{u}</span>)}
                        {rel(s.at)}
                      </div>
                      <pre className="rl-card-body">
                        {expanded.has(i)
                          ? (s.body?.trim() ? s.body : "(empty output)")
                          : preview(s.body)}
                      </pre>
                    </div>
                  )))}
                  {!steps.length && <div className="muted" style={{ fontSize: 12 }}>no events yet</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The strip is the sheet's handle: always visible under the canvas,
          click toggles the sheet; live status so a run is visible even with
          the sheet closed. */}
      <div className="run-strip" onClick={() => p.onToggle(!p.open)}>
        <span className="rs-grip">{p.open ? "▼" : "▲"}</span>
        <span className="rs-label">run inspector</span>
        {p.running && <span className="rs-status">running…</span>}
        {p.pending && !p.running && <span className="rs-status rs-pending">⏸ input needed</span>}
        <span className="spacer" />
        <span className="rs-count muted">{p.runs.length} runs</span>
      </div>
    </>
  );
}

function toggle(set: Set<number>, i: number): Set<number> {
  const next = new Set(set);
  if (next.has(i)) next.delete(i); else next.add(i);
  return next;
}

// Collapsed one-line preview; an absent body is a message, not "undefined".
function preview(body: string | undefined): string {
  const t = body?.trim();
  if (!t) return "(empty output)";
  const first = t.split("\n")[0];
  return first.length > 120 ? first.slice(0, 120) + "…" : first;
}
