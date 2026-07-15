import { Hono } from "hono";
import { applySyncRow, metaGet, metaSet, rowsSince, TABLES, type TableName } from "../db.ts";
import { config } from "../config.ts";
import { listSnapshots, makeSnapshot } from "../core/snapshot.ts";

export const sync = new Hono();

/* peer B calls this on peer A to fetch changes */
sync.get("/pull", (c) => {
  const since = Number(c.req.query("since") ?? 0);
  return c.json({ since, nodeId: config.nodeId, rows: rowsSince(since) });
});

/* peer B calls this on peer A to send changes */
sync.post("/push", async (c) => {
  const delta = (await c.req.json()) as { rows?: { table: string; row: unknown }[] };
  let applied = 0, skipped = 0;
  for (const { table, row } of delta.rows ?? []) {
    if (!(TABLES as readonly string[]).includes(table)) { skipped++; continue; }
    applySyncRow(table as TableName, row) ? applied++ : skipped++;
  }
  return c.json({ ok: true, applied, skipped });
});

/* trigger THIS node to pull from a remote peer (used by the Settings UI) */
sync.post("/pull-from-peer", async (c) => {
  const { peerUrl, token } = (await c.req.json()) as { peerUrl: string; token?: string };
  if (!peerUrl?.startsWith("http")) return c.json({ error: "invalid peerUrl" }, 400);

  const key = `lastPull:${peerUrl}`;
  const since = Number(metaGet(key) ?? 0);
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  let data: { rows?: { table: string; row: unknown }[] };
  try {
    const r = await fetch(`${peerUrl.replace(/\/$/, "")}/api/sync/pull?since=${since}`, { headers });
    if (!r.ok) return c.json({ error: `peer responded ${r.status}` }, 502);
    data = await r.json();
  } catch (e: any) {
    return c.json({ error: `peer unreachable: ${String(e?.message ?? e)}` }, 502);
  }

  let applied = 0, skipped = 0;
  for (const { table, row } of data.rows ?? []) {
    if (!(TABLES as readonly string[]).includes(table)) { skipped++; continue; }
    applySyncRow(table as TableName, row) ? applied++ : skipped++;
  }
  metaSet(key, String(Date.now()));
  return c.json({ ok: true, applied, skipped, since });
});

/* snapshots */
sync.post("/snapshot", async (c) => {
  try {
    return c.json(await makeSnapshot());
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e) }, 500);
  }
});

sync.get("/snapshots", (c) => c.json({ items: listSnapshots() }));
