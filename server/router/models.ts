import { Hono } from "hono";
import { listModels } from "../core/openrouter.ts";

export const models = new Hono();

models.get("/", async (c) => {
  try {
    const data = await listModels();
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e) }, 502);
  }
});
