import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

export const TABLES = ["projects", "skills", "memory_files", "conversations", "graphs", "graph_runs"] as const;
export type TableName = (typeof TABLES)[number];

for (const t of TABLES) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${t} (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updatedAt INTEGER NOT NULL,
    nodeOrigin TEXT NOT NULL
  )`);
}

db.exec(`CREATE TABLE IF NOT EXISTS sync_log (
  id TEXT PRIMARY KEY,
  tbl TEXT NOT NULL,
  rowId TEXT NOT NULL,
  action TEXT NOT NULL,
  nodeOrigin TEXT NOT NULL,
  at INTEGER NOT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`);

export function metaGet(key: string): string | null {
  const r = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as any;
  return r ? r.value : null;
}
export function metaSet(key: string, value: string): void {
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export function listRows<T>(table: TableName): T[] {
  return db.prepare(`SELECT json FROM ${table} ORDER BY updatedAt DESC`).all()
    .map((r: any) => JSON.parse(r.json) as T);
}

export function getRow<T>(table: TableName, id: string): T | null {
  const r = db.prepare(`SELECT json FROM ${table} WHERE id = ?`).get(id) as any;
  return r ? (JSON.parse(r.json) as T) : null;
}

export function upsertRow(table: TableName, row: { id: string }): void {
  const now = Date.now();
  const full = { ...row, updatedAt: now, nodeOrigin: config.nodeId };
  db.prepare(`INSERT INTO ${table} (id, json, updatedAt, nodeOrigin)
    VALUES (@id, @json, @updatedAt, @nodeOrigin)
    ON CONFLICT(id) DO UPDATE SET json=@json, updatedAt=@updatedAt, nodeOrigin=@nodeOrigin`)
    .run({ id: row.id, json: JSON.stringify(full), updatedAt: now, nodeOrigin: config.nodeId });
  db.prepare(`INSERT INTO sync_log (id, tbl, rowId, action, nodeOrigin, at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), table, row.id, "update", config.nodeId, now);
}

export function deleteRow(table: TableName, id: string): void {
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO sync_log (id, tbl, rowId, action, nodeOrigin, at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), table, id, "delete", config.nodeId, Date.now());
}

/* ---------- sync (M6) ---------- */

export function rowsSince(since: number): { table: TableName; row: unknown }[] {
  const out: { table: TableName; row: unknown }[] = [];
  for (const t of TABLES) {
    const rs = db.prepare(`SELECT json FROM ${t} WHERE updatedAt > ?`).all(since);
    for (const r of rs as any[]) out.push({ table: t, row: JSON.parse(r.json) });
  }
  return out;
}

// Last-write-wins: apply incoming row only if newer. Preserves original updatedAt/nodeOrigin.
export function applySyncRow(table: TableName, row: any): boolean {
  if (!row?.id) return false;
  const existing = db.prepare(`SELECT updatedAt FROM ${table} WHERE id = ?`).get(row.id) as any;
  const incomingAt = row.updatedAt ?? 0;
  if (existing && existing.updatedAt >= incomingAt) return false;
  db.prepare(`INSERT INTO ${table} (id, json, updatedAt, nodeOrigin)
    VALUES (@id, @json, @updatedAt, @nodeOrigin)
    ON CONFLICT(id) DO UPDATE SET json=@json, updatedAt=@updatedAt, nodeOrigin=@nodeOrigin`)
    .run({
      id: row.id, json: JSON.stringify(row),
      updatedAt: incomingAt || Date.now(),
      nodeOrigin: row.nodeOrigin || "peer",
    });
  db.prepare(`INSERT INTO sync_log (id, tbl, rowId, action, nodeOrigin, at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), table, row.id, "update", row.nodeOrigin || "peer", Date.now());
  return true;
}
