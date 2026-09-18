import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";
import { hashPassword } from "./core/auth.ts";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

export const TABLES = ["projects", "skills", "prompts", "memory_files", "conversations", "graphs", "graph_runs", "harnesses", "benchmarks"] as const;
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

/* Immutable harness snapshots (git-style): insert-only, content-addressed.
   versionId hashes the row MINUS updatedAt/nodeOrigin so identical content
   saved twice (or on two peers) collapses into one version. */
db.exec(`CREATE TABLE IF NOT EXISTS harness_versions (
  versionId TEXT PRIMARY KEY,
  harnessId TEXT NOT NULL,
  rev INTEGER NOT NULL,
  json TEXT NOT NULL,
  at INTEGER NOT NULL
)`);

export interface VersionRow { id: string; rev?: number }

export function harnessVersionId(row: VersionRow): string {
  const { updatedAt: _u, nodeOrigin: _n, ...content } = row as unknown as Record<string, unknown>;
  return createHash("sha1").update(JSON.stringify(content)).digest("hex");
}

export function versionHarness(row: VersionRow): string {
  const versionId = harnessVersionId(row);
  db.prepare(`INSERT INTO harness_versions (versionId, harnessId, rev, json, at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(versionId) DO NOTHING`).run(
    versionId, row.id, row.rev ?? 0, JSON.stringify(row), Date.now());
  return versionId;
}

export function listVersions(harnessId: string) {
  return db.prepare(`SELECT versionId, harnessId, rev, at FROM harness_versions
    WHERE harnessId = ? ORDER BY at DESC`).all(harnessId);
}

export function getVersion(versionId: string): VersionRow | null {
  const r = db.prepare(`SELECT json FROM harness_versions WHERE versionId = ?`).get(versionId) as any;
  return r ? (JSON.parse(r.json) as VersionRow) : null;
}

// T-04/T-19: per-call accounting. One tasks row per LLM call (chat session,
// context summary, graph node), one tool_events row per tool execution.
// Every token the provider bills lands here exactly once.
db.exec(`CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  at INTEGER NOT NULL,
  durationMs INTEGER,
  promptTokens INTEGER NOT NULL DEFAULT 0,
  completionTokens INTEGER NOT NULL DEFAULT 0,
  cachedTokens INTEGER NOT NULL DEFAULT 0,
  costUsd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT,
  user TEXT NOT NULL DEFAULT 'owner'
)`);
// Pre-existing DBs: CREATE TABLE IF NOT EXISTS won't add the column, so the
// migration runs once and the duplicate-column error is expected noise.
try { db.exec(`ALTER TABLE tasks ADD COLUMN user TEXT NOT NULL DEFAULT 'owner'`); } catch {}

export interface UserRow {
  id: string;
  username: string;
  passHash: string;
  role: "owner" | "admin" | "user";
  quotaTokensPerHour: number | null;
  active: 0 | 1;
  createdAt: number;
}

// Server-side users. Data (projects/conversations/...) stays shared: the user
// identity exists only for login, attribution and quota enforcement.
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  passHash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('owner','admin','user')),
  quotaTokensPerHour INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL
)`);

// Seed: an empty users table would lock everyone out, so the .env owner
// credentials become the first account (backward compatible login).
{
  const n = (db.prepare(`SELECT count(*) AS n FROM users`).get() as any).n;
  if (n === 0) {
    db.prepare(`INSERT INTO users (id, username, passHash, role, quotaTokensPerHour, active, createdAt)
      VALUES (?, ?, ?, 'owner', NULL, 1, ?)`)
      .run(crypto.randomUUID(), config.auth.user, hashPassword(config.auth.password), Date.now());
  }
}

export function userByUsername(username: string): UserRow | null {
  return (db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) ?? null) as UserRow | null;
}

export function userById(id: string): UserRow | null {
  return (db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) ?? null) as UserRow | null;
}

export function usersCount(): number {
  return (db.prepare(`SELECT count(*) AS n FROM users`).get() as any).n;
}

export function insertUser(u: UserRow): void {
  db.prepare(`INSERT INTO users (id, username, passHash, role, quotaTokensPerHour, active, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(u.id, u.username, u.passHash, u.role, u.quotaTokensPerHour, u.active, u.createdAt);
}

export function updateUser(id: string, fields: Partial<Pick<UserRow, "passHash" | "role" | "quotaTokensPerHour" | "active">>): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); vals.push(v); }
  if (!sets.length) return;
  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
};
db.exec(`CREATE TABLE IF NOT EXISTS tool_events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  taskId TEXT,
  name TEXT NOT NULL,
  ok INTEGER NOT NULL,
  durationMs INTEGER,
  args TEXT,
  error TEXT
)`);

db.exec(`CREATE VIEW IF NOT EXISTS v_task_daily AS
  SELECT date(at/1000, 'unixepoch') AS day, model, kind,
    count(*) AS calls, sum(promptTokens) AS prompt, sum(completionTokens) AS completion,
    sum(cachedTokens) AS cached, round(sum(costUsd), 6) AS cost
  FROM tasks GROUP BY day, model, kind ORDER BY day DESC`);
db.exec(`CREATE VIEW IF NOT EXISTS v_tool_stats AS
  SELECT name, count(*) AS calls, sum(ok) AS okCalls, round(avg(durationMs), 1) AS avgMs
  FROM tool_events GROUP BY name`);

// Tombstones remember deleted ids so sync can propagate deletions instead of
// resurrecting them. TOMBSTONE_TTL prunes them once every peer has certainly
// seen the delete (max pull gap is far shorter than 30 days).
db.exec(`CREATE TABLE IF NOT EXISTS tombstones (
  tbl TEXT NOT NULL,
  id TEXT NOT NULL,
  deletedAt INTEGER NOT NULL,
  PRIMARY KEY (tbl, id)
)`);
const TOMBSTONE_TTL = 30 * 24 * 3600 * 1000;

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
  // Same id re-created locally: drop any tombstone so the live row syncs back.
  db.prepare(`DELETE FROM tombstones WHERE tbl = ? AND id = ?`).run(table, row.id);
  db.prepare(`INSERT INTO sync_log (id, tbl, rowId, action, nodeOrigin, at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), table, row.id, "update", config.nodeId, now);
}

export function deleteRow(table: TableName, id: string): void {
  const now = Date.now();
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  db.prepare(`INSERT INTO tombstones (tbl, id, deletedAt) VALUES (?, ?, ?)
    ON CONFLICT(tbl, id) DO UPDATE SET deletedAt = excluded.deletedAt`).run(table, id, now);
  db.prepare(`INSERT INTO sync_log (id, tbl, rowId, action, nodeOrigin, at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), table, id, "delete", config.nodeId, now);
}

/* ---------- T-04/T-19: per-call task & tool log ---------- */

export function createTask(kind: "chat" | "summary" | "graph", model: string, user = "owner"): string {
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO tasks (id, kind, model, at, status, user) VALUES (?, ?, ?, ?, 'running', ?)`)
    .run(id, kind, model, Date.now(), user);
  return id;
}

export function finishTask(
  id: string, status: "ok" | "error",
  u?: { promptTokens?: number; completionTokens?: number; cachedTokens?: number; costUsd?: number },
  error?: string
): void {
  db.prepare(`UPDATE tasks SET status = ?, error = ?, durationMs = ? - at,
    promptTokens = promptTokens + ?, completionTokens = completionTokens + ?,
    cachedTokens = cachedTokens + ?, costUsd = costUsd + ?
    WHERE id = ?`)
    .run(status, error ?? null, Date.now(),
      u?.promptTokens ?? 0, u?.completionTokens ?? 0, u?.cachedTokens ?? 0, u?.costUsd ?? 0, id);
}

export function logToolEvent(
  taskId: string | null, name: string, args: unknown, ok: boolean, durationMs: number, error?: string
): void {
  // Args are only diagnostics: cap them so a huge query can't bloat the DB.
  db.prepare(`INSERT INTO tool_events (id, at, taskId, name, ok, durationMs, args, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), Date.now(), taskId, name, ok ? 1 : 0, durationMs,
      JSON.stringify(args ?? {}).slice(0, 2000), error ?? null);
}

export function metrics(): { totals: Record<string, number>; daily: unknown[]; tools: unknown[] } {
  const totals = (db.prepare(`SELECT count(*) AS calls,
      sum(promptTokens) AS prompt, sum(completionTokens) AS completion,
      sum(cachedTokens) AS cached, round(sum(costUsd), 6) AS cost
    FROM tasks WHERE status = 'ok'`).get() ?? {}) as Record<string, number>;
  const daily = db.prepare(`SELECT * FROM v_task_daily LIMIT 30`).all();
  const tools = db.prepare(`SELECT * FROM v_tool_stats`).all();
  return { totals, daily, tools };
}

/* ---------- sync (M6) ---------- */

export function rowsSince(since: number): { table: TableName; row: unknown }[] {
  const out: { table: TableName; row: unknown }[] = [];
  for (const t of TABLES) {
    const rs = db.prepare(`SELECT json FROM ${t} WHERE updatedAt > ?`).all(since);
    for (const r of rs as any[]) out.push({ table: t, row: JSON.parse(r.json) });
    // Deletions travel as minimal rows marked deleted: { id, deleted, updatedAt }.
    const ts = db.prepare(`SELECT id, deletedAt FROM tombstones WHERE tbl = ? AND deletedAt > ?`).all(t, since);
    for (const r of ts as any[]) out.push({ table: t, row: { id: r.id, deleted: true, updatedAt: r.deletedAt } });
  }
  return out;
}

// Last-write-wins: apply incoming row only if newer. Preserves original updatedAt/nodeOrigin.
// A row marked deleted removes the local copy and leaves a tombstone; a live
// incoming row is skipped if a newer tombstone exists (resurrect guard).
export function applySyncRow(table: TableName, row: any): boolean {
  if (!row?.id) return false;
  if (row.deleted) {
    const deletedAt = row.updatedAt || Date.now();
    const ts = db.prepare(`SELECT deletedAt FROM tombstones WHERE tbl = ? AND id = ?`).get(table, row.id) as any;
    if (ts && ts.deletedAt >= deletedAt) return false;
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id);
    db.prepare(`INSERT INTO tombstones (tbl, id, deletedAt) VALUES (?, ?, ?)
      ON CONFLICT(tbl, id) DO UPDATE SET deletedAt = excluded.deletedAt`).run(table, row.id, deletedAt);
    return true;
  }
  const existing = db.prepare(`SELECT updatedAt FROM ${table} WHERE id = ?`).get(row.id) as any;
  const incomingAt = row.updatedAt ?? 0;
  const ts = db.prepare(`SELECT deletedAt FROM tombstones WHERE tbl = ? AND id = ?`).get(table, row.id) as any;
  if (ts && ts.deletedAt >= incomingAt) return false; // deleted wins over stale live row
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

export function pruneTombstones(): void {
  db.prepare(`DELETE FROM tombstones WHERE deletedAt < ?`).run(Date.now() - TOMBSTONE_TTL);
}

/* ---------- P3: human-in-the-loop run state (ephemeral, never synced) ---------- */
// A paused run parks its execution snapshot here so POST /api/graph/resume
// can continue it in a fresh SSE stream. Rows are machinery, not history:
// deleted on completion, marked abandoned after PAUSE_TTL.
export interface GraphRunSnapshot {
  runId: string;
  graphId: string;
  input: string;
  vars: Record<string, string>;     // live run vars at pause time
  outputs: Record<string, string>;  // nodeId -> completed output
  pendingNodeId?: string;           // human node awaiting an answer
  pendingVarName?: string;          // where that answer lands (var.<name>)
  pendingPrompt?: string;           // resolved question shown again after reload
}

db.exec(`CREATE TABLE IF NOT EXISTS graph_run_state (
  id TEXT PRIMARY KEY,
  graphId TEXT NOT NULL,
  status TEXT NOT NULL,
  json TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
)`);
const PAUSE_TTL = 24 * 3600 * 1000;

export function saveRunState(s: GraphRunSnapshot, status: "running" | "paused"): void {
  db.prepare(`INSERT INTO graph_run_state (id, graphId, status, json, updatedAt)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, json=excluded.json, updatedAt=excluded.updatedAt`)
    .run(s.runId, s.graphId, status, JSON.stringify(s), Date.now());
}

export function getRunState(runId: string): { snapshot: GraphRunSnapshot; status: string } | null {
  const r = db.prepare(`SELECT status, json FROM graph_run_state WHERE id = ?`).get(runId) as any;
  return r ? { snapshot: JSON.parse(r.json) as GraphRunSnapshot, status: r.status } : null;
}

export function updateRunStatus(runId: string, status: string): void {
  db.prepare(`UPDATE graph_run_state SET status = ?, updatedAt = ? WHERE id = ?`)
    .run(status, Date.now(), runId);
}

export function deleteRunState(runId: string): void {
  db.prepare(`DELETE FROM graph_run_state WHERE id = ?`).run(runId);
}

// Runs parked longer than the TTL are dead weight: nobody is coming back.
export function abandonStalePausedRuns(): number {
  const r = db.prepare(`UPDATE graph_run_state SET status = 'abandoned', updatedAt = ?
    WHERE status = 'paused' AND updatedAt < ?`).run(Date.now(), Date.now() - PAUSE_TTL);
  return r.changes;
}
