import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { db, deleteRunState, getRow, getRunState, saveRunState, updateRunStatus } from "../db.ts";
import { runGraph } from "../core/graphRunner.ts";
import { generate } from "../core/generator.ts";
import { checkTokenBudget, budgetMessage } from "../core/budget.ts";
import type { Env } from "../core/auth.ts";
import type { Graph, HumanNode } from "../../shared/types.ts";

export const graph = new Hono<Env>();

// Run-level variables arrive as a flat object; anything that is not a
// string would silently template wrong, so it is rejected up front.
function toVars(input: unknown): Map<string, string> {
  const vars = new Map<string, string>();
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (typeof v !== "string") throw new Error(`variable "${k}" must be a string`);
      vars.set(k, v);
    }
  }
  return vars;
}

// Outputs accumulate from the runner's own node_done emissions: the router
// never re-runs logic, it just records what already happened, so the
// snapshot saved at pause time is exactly the run so far.
function trackOutputs(emit: (ev: object) => Promise<unknown> | unknown) {
  const outputs: Record<string, string> = {};
  let pendingNodeId: string | undefined;
  let pendingVarName: string | undefined;
  let pendingPrompt: string | undefined;
  const wrapped = async (ev: object) => {
    const e = ev as any;
    if (e.type === "node_done") outputs[e.nodeId] = e.output;
    if (e.type === "human_input_required") {
      pendingNodeId = e.nodeId;
      pendingPrompt = e.prompt;
      pendingVarName = e.varName;
    }
    return emit(ev);
  };
  return { wrapped, outputs, state: () => ({ pendingNodeId, pendingVarName, pendingPrompt }) };
}

function nodeName(graphId: string, nodeId: string): string {
  return getRow<Graph>("graphs", graphId)?.nodes.find((n) => n.id === nodeId)?.name ?? nodeId;
}

graph.post("/run", async (c) => {
  const body = (await c.req.json()) as {
    graphId: string; input: string; vars?: Record<string, unknown>; runId?: string;
  };
  const g = getRow<Graph>("graphs", body.graphId);
  if (!g) return c.json({ error: "graph not found" }, 404);
  let vars: Map<string, string>;
  try {
    vars = toVars(body.vars);
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e) }, 400);
  }
  // The client picks the run id so its log record (POST /api/runs with the
  // same id) can upsert the merged run+resume history. Server-side fallback
  // keeps the endpoint honest for direct API callers.
  const runId = body.runId?.trim() ? body.runId.trim() : crypto.randomUUID();
  // H4: reject before the run starts (per-node re-checks live in the runner).
  const tb = checkTokenBudget(c.get("user"));
  if (!tb.ok) return c.json({ error: budgetMessage(tb), resetAt: tb.resetAt }, 429);

  return streamSSE(c, async (stream) => {
    const send = (ev: object) => stream.writeSSE({ data: JSON.stringify(ev) });
    const t = trackOutputs(send);
    saveRunState({ runId, graphId: g.id, input: body.input ?? "", vars: {}, outputs: {} }, "running");
    try {
      const r = await runGraph(g, body.input ?? "", t.wrapped, vars, { runId, user: c.get("user") });
      const st = t.state();
      if (r.pausedNodeId && st.pendingNodeId) {
        const human = g.nodes.find((n) => n.id === st.pendingNodeId) as HumanNode | undefined;
        saveRunState({
          runId, graphId: g.id, input: body.input ?? "",
          vars: Object.fromEntries(vars), outputs: t.outputs,
          pendingNodeId: st.pendingNodeId, pendingVarName: st.pendingVarName ?? human?.varName,
          pendingPrompt: st.pendingPrompt,
        }, "paused");
      } else {
        deleteRunState(runId); // machinery only: a finished run needs no snapshot
      }
      await send({ type: "done" });
    } catch (e: any) {
      deleteRunState(runId);
      await send({ type: "error", message: String(e?.message ?? e) });
    }
  });
});

// Resume a paused run. The answer lands in vars as var.<varName> — the same
// surface every template reads — then execution restarts skipping completed
// nodes. A later human node pauses again with a fresh snapshot.
graph.post("/resume", async (c) => {
  const body = (await c.req.json()) as { runId: string; value: string };
  const st = getRunState(body.runId);
  if (!st) return c.json({ error: "run not found" }, 404);
  if (st.status !== "paused") return c.json({ error: `run is ${st.status}, not paused` }, 409);
  const snap = st.snapshot;
  const g = getRow<Graph>("graphs", snap.graphId);
  if (!g) return c.json({ error: "graph not found" }, 404);
  if (!snap.pendingNodeId) return c.json({ error: "snapshot has no pending node" }, 409);
  const human = g.nodes.find((n) => n.id === snap.pendingNodeId);
  if (!human || human.type !== "human") return c.json({ error: "pending node is not a human node" }, 409);

  const varName = snap.pendingVarName || (human as HumanNode).varName || "answer";
  const pendingId: string = snap.pendingNodeId;
  const vars = new Map<string, string>(Object.entries(snap.vars));
  vars.set(`var.${varName}`, body.value ?? "");
  const tb = checkTokenBudget(c.get("user"));
  if (!tb.ok) return c.json({ error: budgetMessage(tb), resetAt: tb.resetAt }, 429);

  return streamSSE(c, async (stream) => {
    const send = (ev: object) => stream.writeSSE({ data: JSON.stringify(ev) });
    const t = trackOutputs(send);
    try {
      // The answered human node counts as completed with the user's answer
      // as its output: downstream nodes join it like any upstream result,
      // and the scheduler skips it instead of pausing on it again.
      const r = await runGraph(g, snap.input, t.wrapped, vars, {
        runId: snap.runId,
        user: c.get("user"),
        resume: {
          outputs: { ...snap.outputs, [pendingId]: body.value ?? "" },
          vars: Object.fromEntries(vars),
        },
      });
      const s = t.state();
      if (r.pausedNodeId && s.pendingNodeId) {
        saveRunState({
          ...snap, vars: Object.fromEntries(vars), outputs: t.outputs,
          pendingNodeId: s.pendingNodeId, pendingVarName: s.pendingVarName,
          pendingPrompt: s.pendingPrompt,
        }, "paused");
      } else {
        deleteRunState(snap.runId);
      }
      await send({ type: "done" });
    } catch (e: any) {
      // Keep the snapshot paused: the human answer survives, only the
      // downstream stage failed — the user can resume again after fixing.
      saveRunState({ ...snap, vars: Object.fromEntries(vars), outputs: t.outputs }, "paused");
      await send({ type: "error", message: String(e?.message ?? e) });
    }
  });
});

// Runs waiting for a human answer — the UI polls this so a pause that
// happened in another tab (or before a reload) still surfaces a prompt.
graph.get("/pending", (c) => {
  const rows = db.prepare(`SELECT json FROM graph_run_state WHERE status = 'paused' ORDER BY updatedAt`).all() as any[];
  const items = rows.map((r) => {
    const s = JSON.parse(r.json);
    return {
      runId: s.runId, graphId: s.graphId, input: s.input,
      nodeId: s.pendingNodeId, nodeName: s.pendingNodeId ? nodeName(s.graphId, s.pendingNodeId) : "",
      prompt: s.pendingPrompt ?? "", varName: s.pendingVarName ?? "answer",
    };
  });
  return c.json({ items });
});

// Owner override: drop a stalled pause without answering it.
graph.delete("/pending/:runId", (c) => {
  updateRunStatus(c.req.param("runId"), "abandoned");
  return c.json({ ok: true });
});

// AI proposal for a node config or a whole graph. Nothing is persisted:
// the JSON comes back to the client for review/editing before apply.
graph.post("/generate", async (c) => {
  const body = (await c.req.json()) as {
    mode: "node" | "graph"; description: string; model?: string;
    graphId?: string; models?: string[];
  };
  if (!body.model?.trim()) return c.json({ error: "generator model is required" }, 400);
  const contextNodes = body.graphId
    ? getRow<Graph>("graphs", body.graphId)?.nodes ?? []
    : [];
  try {
    const proposal = await generate(
      { mode: body.mode, description: body.description ?? "", model: body.model, contextNodes },
      Array.isArray(body.models) ? body.models : []
    );
    return c.json({ proposal });
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e) }, 502);
  }
});
