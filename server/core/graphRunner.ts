import { buildMessages } from "./promptBuilder.ts";
import { openrouterComplete } from "./openrouter.ts";
import { runTool } from "./tools.ts";
import { createTask, finishTask, getRow, logToolEvent } from "../db.ts";
import { checkTokenBudget, budgetMessage } from "./budget.ts";
import type { Subject } from "./auth.ts";
import { normalizeGraph, topoOrder } from "../../shared/graph.ts";
import { resolveTemplate, slugify } from "../../shared/variables.ts";
import type {
  AgentNode, CuratorNode, Graph, JuryNode, JuryResult, PromptFile, SingleNode, SystemMode, ToolNode, Usage,
} from "../../shared/types.ts";

type Emit = (ev: object) => Promise<unknown> | unknown;

function mapUsage(raw: any, model: string): Usage {
  const promptTokens = raw?.prompt_tokens ?? 0;
  const cachedTokens = raw?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    promptTokens,
    completionTokens: raw?.completion_tokens ?? 0,
    cachedTokens,
    cachedPct: promptTokens ? Math.round((cachedTokens / promptTokens) * 100) : 0,
    costUsd: raw?.cost ?? 0,
    provider: "openrouter",
    model,
  };
}

// Resolves a node's promptIds into rendered persona blocks. A deleted prompt
// must NOT silently vanish from a saved graph — the run stops with a name
// instead of quietly producing wrong prompts (correctness before speed).
function resolvePrompts(n: AgentNode): string[] {
  const out: string[] = [];
  for (const id of n.promptIds ?? []) {
    const p = getRow<PromptFile>("prompts", id);
    if (!p) throw new Error(`node "${n.name}" references a deleted prompt (id ${id})`);
    out.push(`## ${p.name}\n${p.content}`);
  }
  return out;
}

async function complete(
  model: string, system: string | undefined, systemMode: SystemMode,
  promptInstructions: string[], input: string, emit: Emit,
  // Per-node overrides (N5): temperature/reasoning from BaseNode, unset = defaults.
  opts: { temperature?: number; reasoning?: string } = {},
  user?: Subject
): Promise<string> {
  // H4: every node bills, so the quota gate sits here at the billing point.
  const tb = checkTokenBudget(user);
  if (!tb.ok) {
    const e: any = new Error(`${budgetMessage(tb)} (resets at ${new Date(tb.resetAt).toISOString()})`);
    e.resetAt = tb.resetAt;
    e.budget = true;
    throw e;
  }
  const messages = buildMessages({
    systemMode, system, promptInstructions,
    messages: [{ id: "in", role: "user", content: input, createdAt: Date.now() }],
  });
  // Each node call is its own billed task; a failure is still recorded.
  const taskId = createTask("graph", model, user?.username);
  try {
    const { text, usageRaw } = await openrouterComplete({ model, messages, temperature: opts.temperature, reasoning: opts.reasoning });
    await emit({ type: "usage", usage: mapUsage(usageRaw, model) });
    const u = usageRaw as any;
    finishTask(taskId, "ok", {
      promptTokens: u?.prompt_tokens,
      completionTokens: u?.completion_tokens,
      cachedTokens: u?.prompt_tokens_details?.cached_tokens,
      costUsd: u?.cost,
    });
    return text;
  } catch (e: any) {
    finishTask(taskId, "error", undefined, String(e?.message ?? e));
    throw e;
  }
}

/* ---------- DAG execution ---------- */

// The graph is a flat DAG: edges are the flow, topoOrder is the schedule.
// Each node joins its upstream outputs (or falls back to the user input when
// it has none); the final result joins the sink outputs in topo order.
// final === null means the run parked on a human node: the router persists
// the snapshot and a later /resume call re-enters with outputs pre-filled.
export interface GraphRunResult {
  final: string | null;
  pausedNodeId: string | null;
}

export interface RunOptions {
  runId?: string;
  // Authenticated subject: bills nodes to this user and enforces their quota.
  user?: Subject;
  resume?: { outputs: Record<string, string>; vars: Record<string, string> };
}

export async function runGraph(
  raw: Graph, input: string, emit: Emit,
  vars: Map<string, string> = new Map(), opts: RunOptions = {}
): Promise<GraphRunResult> {
  const graph = normalizeGraph(raw);
  const ordered = topoOrder(graph.nodes, graph.edges);
  if (!ordered.length) throw new Error("graph has no nodes");

  const outputs = new Map<string, string>(Object.entries(opts.resume?.outputs ?? {}));
  if (opts.resume) for (const [k, v] of Object.entries(opts.resume.vars)) vars.set(k, v);

  for (const n of ordered) {
    if (outputs.has(n.id)) continue; // resumed run: completed nodes are skipped

    // Human node: the run parks here. The answer will arrive as a run
    // variable (var.<varName>) on /resume — downstream templates read it
    // like any other variable, no special-casing after the restart.
    if (n.type === "human") {
      await emit({ type: "node_start", nodeId: n.id });
      await emit({
        type: "human_input_required", runId: opts.runId ?? "",
        nodeId: n.id, prompt: resolveTemplate(n.prompt, vars) || n.name,
        varName: n.varName || "answer",
      });
      return { final: null, pausedNodeId: n.id };
    }

    // inputTemplate replaces the default join: the node text itself pulls
    // what it needs (run vars + any upstream output) via {{key}}. A
    // missing key throws here — the run stops with the key name instead
    // of feeding the node a silently hollowed prompt.
    const nodeInput = n.inputTemplate?.trim()
      ? resolveTemplate(n.inputTemplate, vars)
      : (() => {
          const ins = graph.edges
            .filter((e) => e.to === n.id)
            .map((e) => outputs.get(e.from))
            .filter((t): t is string => !!t);
          return ins.length ? ins.join("\n\n---\n\n") : input;
        })();
    const out = await runNode(n, nodeInput, emit, vars, opts.user);
    outputs.set(n.id, out);
    // Both keys point at the same text: machines use the id, humans the
    // name alias they typed in the template.
    vars.set(`${n.id}.output`, out);
    vars.set(`${slugify(n.name)}.output`, out);
  }

  // A finite DAG always has at least one sink (a cycle would have thrown).
  const sinks = ordered.filter((n) => !graph.edges.some((e) => e.from === n.id));
  const finals = sinks.map((n) => outputs.get(n.id)!);
  return {
    final: finals.length === 1
      ? finals[0]
      : finals.map((t, i) => `--- Output ${i + 1} ---\n\n${t}`).join("\n\n"),
    pausedNodeId: null,
  };
}

async function runNode(node: AgentNode, input: string, emit: Emit, vars: Map<string, string>, user?: Subject): Promise<string> {
  await emit({ type: "node_start", nodeId: node.id });
  let out: string;
  if (node.type === "single") out = await runSingle(node, input, emit, vars, user);
  else if (node.type === "jury") out = await runJury(node, input, emit, user);
  else if (node.type === "curator") out = await runCurator(node, input, emit, vars, user);
  else if (node.type === "tool") out = await runToolNode(node, emit, vars);
  else throw new Error(`node type "${node.type}" is not implemented`);
  await emit({ type: "node_done", nodeId: node.id, output: out });
  return out;
}

function runSingle(n: SingleNode, input: string, emit: Emit, vars: Map<string, string>, user?: Subject): Promise<string> {
  // The node system is also a template surface: {{var.x}} there lets run
  // inputs steer persona instructions, not just the message body.
  const system = n.system ? resolveTemplate(n.system, vars) : undefined;
  return complete(n.model, system, n.systemMode, resolvePrompts(n), input, emit,
    { temperature: n.temperature, reasoning: n.reasoning }, user);
}

async function runJury(n: JuryNode, input: string, emit: Emit, user?: Subject): Promise<string> {
  const personas = resolvePrompts(n);
  const answers = await Promise.all(
    n.panel.map(async (model) => {
      await emit({ type: "node_start", nodeId: model });
      const text = await complete(model, n.system, n.systemMode, personas, input, emit,
        { temperature: n.temperature, reasoning: n.reasoning }, user);
      await emit({ type: "node_done", nodeId: model, output: text });
      return { model, text };
    })
  );

  const judgeSystem =
    `You are an impartial judge. Score each candidate answer from 0 to 10 against these criteria: ` +
    `${n.criteria.join(", ")}. Respond with STRICT JSON only: ` +
    `{"scores":[{"model":string,"score":number,"notes":string}],"winner":string,"rationale":string}. ` +
    `"winner" must be exactly one of the candidate model ids.`;
  const judgeInput =
    `Question:\n${input}\n\n` +
    answers.map((a, i) => `--- Candidate ${i + 1} (${a.model}) ---\n${a.text}`).join("\n\n");

  const judgeId = `judge (${n.judge})`;
  await emit({ type: "node_start", nodeId: judgeId });
  const verdictRaw = await complete(n.judge, judgeSystem, "replace", [], judgeInput, emit, {}, user);
  await emit({ type: "node_done", nodeId: judgeId, output: verdictRaw });

  let result: JuryResult | null = null;
  const m = verdictRaw.match(/\{[\s\S]*\}/);
  if (m) { try { result = JSON.parse(m[0]) as JuryResult; } catch { /* keep raw */ } }

  const winnerText = result
    ? (answers.find((a) => a.model === result!.winner)?.text ?? answers[0].text)
    : answers[0].text;

  if (n.winnerOnly) return winnerText;

  const verdict = result ? JSON.stringify(result, null, 2) : verdictRaw;
  return `## Winner: ${result?.winner ?? "(unparsed verdict)"}\n\n${winnerText}\n\n## Verdict\n\`\`\`json\n${verdict}\n\`\`\``;
}

// Curator: an LLM gate between stages. The built-in preamble carries the
// criteria and mode (so a bare curator is already useful); the node's own
// system text, when present, is appended — always under "replace" so the
// preamble cannot be dropped by a wrong systemMode choice on the card.
async function runCurator(n: CuratorNode, input: string, emit: Emit, vars: Map<string, string>, user?: Subject): Promise<string> {
  if (!n.model.trim()) throw new Error(`curator "${n.name}": pick a model`);
  const behavior = n.mode === "pass"
    ? "Rewrite and collate the selected fragments into one coherent, self-contained text. Drop everything that does not make the cut."
    : "Output ONLY the selected fragments verbatim, separated by a blank line. No commentary, no preamble.";
  const criteria = n.criteria.length
    ? n.criteria.map((c) => `- ${c}`).join("\n")
    : "- relevance to the downstream task";
  const preamble =
    `You are a curator between pipeline stages. From the input, select the fragments worth passing forward.\n` +
    `Criteria:\n${criteria}\n${behavior}`;
  const system = n.system?.trim() ? `${preamble}\n\n${resolveTemplate(n.system, vars)}` : preamble;
  return complete(n.model, system, "replace", resolvePrompts(n), input, emit,
    { temperature: n.temperature, reasoning: n.reasoning }, user);
}

// Tool node: fixed executor, zero LLM. Arg values are templates so a saved
// graph can pull run vars / upstream outputs into the query.
async function runToolNode(n: ToolNode, emit: Emit, vars: Map<string, string>): Promise<string> {
  const resolved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.args)) resolved[k] = resolveTemplate(v, vars);
  const t0 = Date.now();
  const result = await runTool(n.tool, resolved);
  const err = (result as any)?.error;
  // Same accounting as chat-executed tools: one tool_events row, always.
  logToolEvent(null, n.tool, resolved, !err, Date.now() - t0, err);
  return JSON.stringify(result, null, 2);
}
