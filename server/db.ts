import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

// Every entity is stored as a JSON blob + sync-ready columns (updatedAt, nodeOrigin).
const TABLES = ["projects", "skills", "memory_files", "conversations", "graphs"] as const;
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
