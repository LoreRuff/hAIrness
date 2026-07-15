import { buildMessages } from "./promptBuilder.ts";
import { openrouterComplete } from "./openrouter.ts";
import type {
  AgentNode, Graph, JuryNode, JuryResult, PipelineNode, SingleNode, SystemMode, Usage,
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

async function complete(
  model: string, system: string | undefined, systemMode: SystemMode,
  input: string, emit: Emit
): Promise<string> {
  const messages = buildMessages({
    systemMode, system,
    messages: [{ id: "in", role: "user", content: input, createdAt: Date.now() }],
  });
  const { text, usageRaw } = await openrouterComplete({ model, messages });
  await emit({ type: "usage", usage: mapUsage(usageRaw, model) });
  return text;
}

function findNode(graph: Graph, parent: AgentNode, id: string): AgentNode | undefined {
  return parent.nodes?.find((n) => n.id === id) ?? graph.nodes.find((n) => n.id === id);
}

export async function runGraph(graph: Graph, input: string, emit: Emit): Promise<string> {
  const root = graph.nodes[0];
  if (!root) throw new Error("graph has no nodes");
  return runNode(graph, root, input, emit);
}

async function runNode(graph: Graph, node: AgentNode, input: string, emit: Emit): Promise<string> {
  await emit({ type: "node_start", nodeId: node.id });
  let out: string;
  if (node.type === "single") out = await runSingle(node, input, emit);
  else if (node.type === "pipeline") out = await runPipeline(graph, node, input, emit);
  else if (node.type === "jury") out = await runJury(node, input, emit);
  else throw new Error(`node type "${node.type}" not implemented yet (M5 covers single/pipeline/jury)`);
  await emit({ type: "node_done", nodeId: node.id, output: out });
  return out;
}

function runSingle(n: SingleNode, input: string, emit: Emit): Promise<string> {
  return complete(n.model, n.system, n.systemMode, input, emit);
}

async function runPipeline(graph: Graph, n: PipelineNode, input: string, emit: Emit): Promise<string> {
  let out = input;
  for (const id of n.steps) {
    const child = findNode(graph, n, id);
    if (!child) throw new Error(`pipeline step "${id}" not found`);
    out = await runNode(graph, child, out, emit);
  }
  return out;
}

async function runJury(n: JuryNode, input: string, emit: Emit): Promise<string> {
  const answers = await Promise.all(
    n.panel.map(async (model) => ({
      model,
      text: await complete(model, n.system, n.systemMode, input, emit),
    }))
  );

  const judgeSystem =
    `You are an impartial judge. Score each candidate answer from 0 to 10 against these criteria: ` +
    `${n.criteria.join(", ")}. Respond with STRICT JSON only: ` +
    `{"scores":[{"model":string,"score":number,"notes":string}],"winner":string,"rationale":string}. ` +
    `"winner" must be exactly one of the candidate model ids.`;
  const judgeInput =
    `Question:\n${input}\n\n` +
    answers.map((a, i) => `--- Candidate ${i + 1} (${a.model}) ---\n${a.text}`).join("\n\n");

  const verdictRaw = await complete(n.judge, judgeSystem, "replace", judgeInput, emit);

  let result: JuryResult | null = null;
  const m = verdictRaw.match(/\{[\s\S]*\}/);
  if (m) { try { result = JSON.parse(m[0]) as JuryResult; } catch { /* keep raw */ } }

  const winnerText = result
    ? (answers.find((a) => a.model === result!.winner)?.text ?? answers[0].text)
    : answers[0].text;
  const verdict = result ? JSON.stringify(result, null, 2) : verdictRaw;
  return `## Winner: ${result?.winner ?? "(unparsed verdict)"}\n\n${winnerText}\n\n## Verdict\n\`\`\`json\n${verdict}\n\`\`\``;
}
