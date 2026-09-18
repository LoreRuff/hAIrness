// ============================================================
// Graph shape helpers — shared by runner (server) and canvas (web)
// ============================================================
// Both sides must agree on ONE graph shape. Edges are the source of truth
// for flow; nodes[] is flat. Legacy rows (pre-DAG editor) stored a single
// root node with children nested inside — normalizeGraph flattens them on
// read so old graphs keep running without any stored-data migration.
import type { AgentNode, Graph } from "./types.ts";

/* ---------- Legacy -> DAG normalization ---------- */

export function normalizeGraph(g: Graph): Graph {
  if (g.edges?.length) return g; // already DAG-shaped
  const root = g.nodes[0];
  // Legacy pipeline: children nested under a container root; steps = order.
  // The container itself carries no model, so it dissolves into chain edges.
  if (root?.type === "pipeline" && root.nodes?.length) {
    const steps = root.steps?.length ? root.steps : root.nodes.map((c) => c.id);
    const ordered = steps
      .map((id) => root.nodes!.find((c) => c.id === id))
      .filter((c): c is AgentNode => !!c);
    const nodes = ordered.map((n, i) => ({
      ...n,
      position: n.position ?? { x: i * 320, y: 0 },
    }));
    const edges = ordered
      .slice(1)
      .map((n, i) => ({ from: ordered[i].id, to: n.id }));
    return { ...g, nodes, edges };
  }
  // Legacy jury (single root) and fresh disconnected drafts are already
  // flat — pass through untouched.
  return g;
}

/* ---------- Topological order (Kahn) ---------- */

// Throws on cycles: the canvas must not be able to save a graph the
// runner refuses to execute — a silent branch would be a correctness lie.
export function topoOrder(
  nodes: AgentNode[],
  edges: { from: string; to: string }[]
): AgentNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    // Ignore stale edges pointing at deleted nodes — save() rewrites edges,
    // but a hand-edited row must not crash the runner.
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
  }
  const queue = nodes.filter((n) => (indeg.get(n.id) || 0) === 0);
  const out: AgentNode[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const e of edges) {
      if (e.from !== n.id || !byId.has(e.to)) continue;
      const d = (indeg.get(e.to) || 0) - 1;
      indeg.set(e.to, d);
      if (d === 0) queue.push(byId.get(e.to)!);
    }
  }
  if (out.length !== nodes.length) {
    const stuck = nodes.filter((n) => !out.includes(n)).map((n) => n.name || n.id);
    throw new Error(`graph has a cycle involving: ${stuck.join(", ")}`);
  }
  return out;
}
