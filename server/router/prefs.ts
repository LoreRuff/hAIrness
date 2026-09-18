import { Hono } from "hono";
import { metaGet, metaSet } from "../db.ts";

export const prefs = new Hono();

// H3: secrets live only in localStorage. They must never reach DB meta,
// which flows into snapshots and B2 backups in cleartext.
const SECRET_KEYS = new Set(["harness_token", "harness_peer_tok"]);

function scrub(p: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) if (!SECRET_KEYS.has(k)) out[k] = v;
  return out;
}

prefs.get("/", (c) => {
  let p: Record<string, string> = {};
  try { p = JSON.parse(metaGet("uiPrefs") ?? "{}"); } catch { /* corrupt → start clean */ }
  const clean = scrub(p);
  // one-shot migration: a pre-H3 value still holding secrets is cleaned in place
  if (Object.keys(clean).length !== Object.keys(p).length) metaSet("uiPrefs", JSON.stringify(clean));
  return c.json(clean);
});

prefs.put("/", async (c) => {
  metaSet("uiPrefs", JSON.stringify(scrub(await c.req.json())));
  return c.json({ ok: true });
});
