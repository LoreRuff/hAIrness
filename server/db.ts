import Database from "better-sqlite3";
import { config } from "./config.ts";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// --- migrations (idempotent) ---
db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  projectId TEXT,
  title TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  nodeOrigin TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments TEXT,          -- JSON array
  usage TEXT,                -- JSON Usage
  createdAt INTEGER NOT NULL,
  FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  tools TEXT,                -- JSON array
  files TEXT,                -- JSON {soul,facts}
  scope TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  nodeOrigin TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_files (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  nodeOrigin TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  activeSkills TEXT,         -- JSON array
  activeMemory TEXT,         -- JSON MemoryRef
  defaultModel TEXT,
  updatedAt INTEGER NOT NULL,
  nodeOrigin TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_log (
  id TEXT PRIMARY KEY,
  tbl TEXT NOT NULL,
  rowId TEXT NOT NULL,
  action TEXT NOT NULL,
  nodeOrigin TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversationId);
`);

console.log("[db] ready at", config.dbPath);
