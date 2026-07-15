import { Hono } from "hono";
import { metaGet, metaSet } from "../db.ts";

export const prefs = new Hono();

prefs.get("/", (c) => {
  try { return c.json(JSON.parse(metaGet("uiPrefs") ?? "{}")); }
  catch { return c.json({}); }
});

prefs.put("/", async (c) => {
  metaSet("uiPrefs", JSON.stringify(await c.req.json()));
  return c.json({ ok: true });
});
