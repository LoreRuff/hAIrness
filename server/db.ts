import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, projectId TEXT, title TEXT NOT NULL,
  updatedAt INTEGER NOT NULL, nodeOrigin TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversationId TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, attachments TEXT, usage TEXT, createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, instructions TEXT,
  tools TEXT, files TEXT, scope TEXT NOT NULL, updatedAt INTEGER NOT NULL, nodeOrigin TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_files (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL,
  updatedAt INTEGER NOT NULL, nodeOrigin TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, activeSkills TEXT,
  activeMemory TEXT, defaultModel TEXT, updatedAt INTEGER NOT NULL, nodeOrigin TEXT NOT NULL);
`);

console.log("[db] ready at", config.dbPath);
