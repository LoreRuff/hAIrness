// ============================================================
// P3 generators: AI-proposed node config / whole graph
// ============================================================
// The user describes WHAT, the model proposes the config. The proposal is
// always a reviewable artifact: nothing here writes to the DB or canvas —
// the router returns JSON and the client shows it for editing before apply.
// Correctness: every proposal is shape-validated; a graph that would not
// run (cycle, unknown node ref) is rejected and regenerated with the
// validator error fed back to the model (max 2 retries).
import { nanoid } from "nanoid";
import { openrouterComplete } from "./openrouter.ts";
import { topoOrder } from "../../shared/graph.ts";
import type { AgentNode } from "../../shared/types.ts";

export interface GenerateParams {
  mode: "node" | "graph";
  description: string;
  model: string;                 // the generator's own model
  contextNodes?: AgentNode[];    // mode "node": the graph being edited
}

const MAX_ATTEMPTS = 3;

const NODE_CONTRACT = `A node is STRICT JSON, one of:
- {"type":"single","name":string,"model":string,"system":string,"systemMode":"append"|"replace","inputTemplate"?:string,"tools"?:["web_search"]}
- {"type":"jury","name":string,"panel":[string,string,...2+ models],"judge":string,"criteria":string[],"winnerOnly"?:boolean,"system"?:string,"systemMode"?:string}
- {"type":"curator","name":string,"model":string,"criteria":string[],"mode":"filter"|"pass","system"?:string}
- {"type":"tool","name":string,"tool":"web_search","args":{"query":string}}
- {"type":"human","name":string,"prompt":string,"varName":string}
Rules: model ids must come from the provided list verbatim. varName and node names: latin letters/digits/underscore/spaces only.
inputTemplate (optional) pulls variables: {{var.<key>}} for run variables, {{<node-name-slug>.output}} for upstream outputs (slug = lowercase name, spaces -> _).`;

const GRAPH_CONTRACT = `The graph is STRICT JSON:
{"name":string,"nodes":[<node objects, see below, plus "position":{"x":number,"y":number}>],"edges":[{"from":string,"to":string}]}
Edges reference node NAMES, not ids. Flow left-to-right: position.x = depth*300, siblings spread on y (step 150). Choose models per node role: reasoning/planning -> a strong model, cheap transform steps -> a fast/cheap one.`;

function systemPrompt(p: GenerateParams): string {
  const nodes = p.mode === "node"
    ? `The graph being edited already has these nodes (do not duplicate their roles):\n${JSON.stringify((p.contextNodes ?? []).map(({ id: _i, position: _p, inputs: _in, outputs: _o, nodes: _n, ...rest }) => rest), null, 1)}\n`
    : "";
  return `You are a configuration generator for an LLM node-graph harness. The user describes what a node (or a whole graph) must do; you propose the config. ${nodes}Return STRICT JSON only — no markdown fences, no commentary.\n\n${NODE_CONTRACT}\n\n${p.mode === "graph" ? GRAPH_CONTRACT : ""}Available models:\n${p.model}`;
}

// Models travel as a plain newline list; the contract sentence embeds it.
function withModels(p: GenerateParams, models: string[]): GenerateParams {
  return { ...p, model: models.filter(Boolean).join("\n") || p.model };
}

function extractJson(text: string): unknown {
  // Fences are the common leak; after stripping, the payload is the
  // outermost {...}. Anything else is a validation error, not a guess.
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the proposal");
  return JSON.parse(stripped.slice(start, end + 1));
}

function str(v: unknown, field: string, max = 8000): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`field "${field}" must be a non-empty string`);
  return v.slice(0, max);
}

const NAME_RE = /^[a-zA-Z0-9_ ]{1,80}$/;

function baseOf(raw: any): { name: string; system?: string; systemMode: "append" | "replace"; inputTemplate?: string } {
  const name = str(raw.name, "name", 80);
  if (!NAME_RE.test(name)) throw new Error(`node name "${name}" has forbidden characters`);
  return {
    name,
    systemMode: raw.systemMode === "replace" ? "replace" : "append",
    ...(raw.system ? { system: str(raw.system, "system") } : {}),
    ...(raw.inputTemplate ? { inputTemplate: str(raw.inputTemplate, "inputTemplate") } : {}),
  };
}

function validateNode(raw: any): AgentNode {
  const base = baseOf(raw);
  const id = nanoid(8);
  const empty = { skills: [], memory: { soul: null, facts: [] }, tools: [], inputs: [], outputs: [] };
  switch (raw.type) {
    case "single":
      return { ...empty, id, type: "single", ...base, model: str(raw.model, "model") };
    case "jury": {
      const panel: unknown[] = raw.panel;
      if (!Array.isArray(panel) || panel.filter((x) => typeof x === "string" && x.trim()).length < 2)
        throw new Error("jury needs ≥2 panel models");
      return {
        ...empty, id, type: "jury", ...base,
        panel: panel.map((x: any) => String(x ?? "").trim()).filter(Boolean),
        judge: str(raw.judge, "judge"),
        criteria: Array.isArray(raw.criteria) ? raw.criteria.map((c: any) => String(c)).filter(Boolean) : ["accuracy"],
        ...(raw.winnerOnly ? { winnerOnly: true } : {}),
      };
    }
    case "curator":
      return {
        ...empty, id, type: "curator", ...base, model: str(raw.model, "model"),
        criteria: Array.isArray(raw.criteria) ? raw.criteria.map((c: any) => String(c)).filter(Boolean) : ["relevance"],
        mode: raw.mode === "pass" ? "pass" : "filter",
      };
    case "tool": {
      if (raw.tool !== "web_search") throw new Error(`tool "${raw.tool}" has no server-side executor (v1: web_search)`);
      const args = raw.args ?? {};
      return { ...empty, id, type: "tool", ...base, tool: "web_search", args: { query: str(args.query, "args.query") } };
    }
    case "human":
      return {
        ...empty, id, type: "human", ...base,
        prompt: str(raw.prompt, "prompt"),
        varName: (str(raw.varName ?? "answer", "varName", 60)).replace(/[^a-zA-Z0-9_]/g, "") || "answer",
      };
    default:
      throw new Error(`node type "${raw.type}" is not generatable (v1: single/jury/curator/tool/human)`);
  }
}

function slugifyName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Left-to-right auto-layout by topological depth (longest path from a
// source): x = depth step, y spreads siblings. The LLM may propose
// positions; syntactically valid ones are kept.
function layout(nodes: AgentNode[], edges: { from: string; to: string }[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number>();
  const level = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    const ups = edges.filter((e) => e.to === id).map((e) => e.from).filter((f) => byId.has(f));
    const v = ups.length ? Math.max(...ups.map(level)) + 1 : 0;
    memo.set(id, v);
    return v;
  };
  const perLevel = new Map<number, number>();
  for (const n of nodes) {
    const d = level(n.id);
    const row = perLevel.get(d) ?? 0;
    perLevel.set(d, row + 1);
    const proposed = (n as any).position;
    n.position = (proposed && typeof proposed.x === "number" && typeof proposed.y === "number")
      ? proposed
      : { x: d * 300, y: row * 150 };
  }
}

export interface GeneratedGraph { name: string; nodes: AgentNode[]; edges: { from: string; to: string }[] }

export async function generate(p: GenerateParams, models: string[]): Promise<AgentNode | GeneratedGraph> {
  if (!p.description.trim()) throw new Error("description is empty");
  const params = withModels(p, models);
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptMsg = lastError
      ? `\n\nYour previous proposal was rejected: ${lastError}\nFix it and return the corrected STRICT JSON.`
      : "";
    const { text } = await openrouterComplete({
      model: params.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt(params) + attemptMsg },
        { role: "user", content: p.description },
      ],
    });
    try {
      const raw = extractJson(text);
      if (p.mode === "node") return validateNode(raw);
      return validateGraph(raw);
    } catch (e: any) {
      lastError = String(e?.message ?? e);
    }
  }
  throw new Error(`generator failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

// Names are the LLM's edge currency; ids are ours. Duplicate/unknown names
// are validator errors — the retry loop feeds them back.
function validateGraph(raw: any): GeneratedGraph {
  const name = str(raw.name ?? "generated graph", "name", 120);
  if (!Array.isArray(raw.nodes) || !raw.nodes.length) throw new Error("graph needs a nodes array");
  const nodes = raw.nodes.map(validateNode);
  const byName = new Map<string, AgentNode>();
  for (const n of nodes) {
    const key = slugifyName(n.name);
    if (byName.has(key)) throw new Error(`duplicate node name "${n.name}"`);
    byName.set(key, n);
  }
  const edges = (Array.isArray(raw.edges) ? raw.edges : []).map((e: any) => {
    const from = byName.get(slugifyName(String(e.from ?? "")));
    const to = byName.get(slugifyName(String(e.to ?? "")));
    if (!from || !to) throw new Error(`edge "${e.from}" -> "${e.to}" references an unknown node`);
    return { from: from.id, to: to.id };
  });
  // The runner must accept what we propose: same cycle check as the canvas.
  topoOrder(nodes, edges);
  layout(nodes, edges);
  return { name, nodes, edges };
}
