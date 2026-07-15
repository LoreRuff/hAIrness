import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getRow } from "../db.ts";
import { runGraph } from "../core/graphRunner.ts";
import type { Graph } from "../../shared/types.ts";

export const graph = new Hono();

graph.post("/run", async (c) => {
  const { graphId, input } = (await c.req.json()) as { graphId: string; input: string };
  const g = getRow<Graph>("graphs", graphId);
  if (!g) return c.json({ error: "graph not found" }, 404);

  return streamSSE(c, async (stream) => {
    const send = (ev: object) => stream.writeSSE({ data: JSON.stringify(ev) });
    try {
      await runGraph(g, input ?? "", send);
      await send({ type: "done" });
    } catch (e: any) {
      await send({ type: "error", message: String(e?.message ?? e) });
    }
  });
});
