// QA for the legacy->DAG migration: every graph saved by the pre-canvas editor
// (root pipeline with nested children, or a single jury root) must keep running
// under the new edge-driven runner. These are the paths that historically break.
import { describe, expect, test } from "bun:test";
import { normalizeGraph, topoOrder } from "./graph.ts";
import type { AgentNode, Graph, JuryNode, PipelineNode, SingleNode } from "./types.ts";

const base = {
  skills: [] as string[], memory: { soul: null, facts: [] as string[] },
  tools: [] as string[], inputs: [] as string[], outputs: [] as string[],
};
const single = (id: string, promptIds?: string[]): SingleNode =>
  ({ ...base, id, type: "single", name: id, systemMode: "append", model: "m", ...(promptIds ? { promptIds } : {}) });
const jury = (id: string): JuryNode =>
  ({ ...base, id, type: "jury", name: id, systemMode: "append", panel: ["a", "b"], judge: "j", criteria: ["accuracy"] });
const graph = (nodes: AgentNode[], edges: { from: string; to: string }[]): Graph =>
  ({ id: "g", name: "g", nodes, edges, updatedAt: 0, nodeOrigin: "test" });

describe("normalizeGraph", () => {
  test("legacy pipeline root flattens into a chain with auto positions", () => {
    const c1 = single("c1");
    const c2 = single("c2", ["p1"]);
    const root: PipelineNode = { ...base, id: "root", type: "pipeline", name: "pipe", systemMode: "append", steps: ["c1", "c2"], nodes: [c1, c2] };
    const out = normalizeGraph(graph([root], []));
    expect(out.nodes.map((n) => n.id)).toEqual(["c1", "c2"]);
    expect(out.edges).toEqual([{ from: "c1", to: "c2" }]);
    expect(out.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(out.nodes[1].position).toEqual({ x: 320, y: 0 });
    // the container root must be gone: it holds no model, only ordering
    expect(out.nodes.some((n) => n.id === "root")).toBe(false);
    // promptIds survive the migration
    expect((out.nodes[1] as SingleNode).promptIds).toEqual(["p1"]);
  });

  test("legacy pipeline with a jury child keeps the jury as a runnable node", () => {
    const j = jury("j1");
    const root: PipelineNode = { ...base, id: "root", type: "pipeline", name: "pipe", systemMode: "append", steps: ["j1"], nodes: [j] };
    const out = normalizeGraph(graph([root], []));
    expect(out.nodes.map((n) => n.type)).toEqual(["jury"]);
    expect(out.edges).toEqual([]);
  });

  test("legacy steps order wins over nested array order", () => {
    const a = single("a");
    const b = single("b");
    const root: PipelineNode = { ...base, id: "root", type: "pipeline", name: "pipe", systemMode: "append", steps: ["b", "a"], nodes: [a, b] };
    const out = normalizeGraph(graph([root], []));
    expect(out.edges).toEqual([{ from: "b", to: "a" }]);
  });

  test("DAG-shaped graph passes through untouched", () => {
    const g = graph([single("x")], [{ from: "x", to: "y" }]);
    expect(normalizeGraph(g)).toBe(g);
  });

  test("single-root jury and disconnected drafts are NOT collapsed", () => {
    const j = jury("j");
    expect(normalizeGraph(graph([j], [])).nodes).toHaveLength(1);
    const draft = graph([single("a"), single("b")], []);
    const out = normalizeGraph(draft);
    expect(out.nodes).toHaveLength(2);
  });
});

describe("topoOrder", () => {
  test("chain order", () => {
    const ordered = topoOrder(
      [single("c"), single("a"), single("b")],
      [{ from: "a", to: "b" }, { from: "b", to: "c" }]
    );
    expect(ordered.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  test("diamond: every node appears, sinks last", () => {
    const ordered = topoOrder(
      [single("d"), single("b"), single("c"), single("a")],
      [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }]
    );
    expect(ordered).toHaveLength(4);
    expect(ordered[0].id).toBe("a");
    expect(ordered[3].id).toBe("d");
  });

  test("throws on cycle with the stuck node names", () => {
    expect(() =>
      topoOrder([single("a"), single("b")], [{ from: "a", to: "b" }, { from: "b", to: "a" }])
    ).toThrow(/cycle involving: a, b/);
  });

  test("stale edges (deleted endpoints) are ignored, not crashed on", () => {
    const ordered = topoOrder([single("a")], [{ from: "ghost", to: "a" }, { from: "a", to: "missing" }]);
    expect(ordered.map((n) => n.id)).toEqual(["a"]);
  });
});
