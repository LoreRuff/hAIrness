import { Hono } from "hono";
import { nanoid } from "nanoid";
import { listRows, getRow, upsertRow, deleteRow, type TableName } from "../db.ts";

export function crudRouter(table: TableName) {
  const r = new Hono();

  r.get("/", (c) => c.json({ items: listRows(table) }));

  r.get("/:id", (c) => {
    const row = getRow(table, c.req.param("id"));
    return row ? c.json(row) : c.json({ error: "not found" }, 404);
  });

  r.post("/", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const row = { ...body, id: (body.id as string) || nanoid(12) };
    upsertRow(table, row as { id: string });
    return c.json(getRow(table, row.id));
  });

  r.put("/:id", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const row = { ...body, id: c.req.param("id") };
    upsertRow(table, row as { id: string });
    return c.json(getRow(table, row.id));
  });

  r.delete("/:id", (c) => {
    deleteRow(table, c.req.param("id"));
    return c.json({ ok: true });
  });

  return r;
}
