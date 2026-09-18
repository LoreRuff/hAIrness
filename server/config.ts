import "dotenv/config";
import { nanoid } from "nanoid";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

// H2: auth is always on. Credentials come from .env; if missing they are
// generated once and persisted to <dbDir>/auth (0600) so the owner can read
// them a single time. The value is never logged again.
function loadAuth(): { user: string; password: string } {
  const user = (process.env.HARNESS_USER ?? "").trim();
  const password = (process.env.HARNESS_PASSWORD ?? "").trim();
  if (user && password) return { user, password };
  const dir = dirname(process.env.DB_PATH ?? "./data/harness.db");
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/auth`;
  if (existsSync(file)) {
    const line = readFileSync(file, "utf8").trim();
    const i = line.indexOf(":");
    if (i > 0) return { user: line.slice(0, i), password: line.slice(i + 1) };
  }
  const gen = { user: "owner", password: randomBytes(12).toString("base64url") };
  writeFileSync(file, `${gen.user}:${gen.password}\n`, { mode: 0o600 });
  console.log(`[harness] no HARNESS_USER/HARNESS_PASSWORD in .env — generated credentials in ${file} (read once, chmod 600)`);
  return gen;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  nodeId: process.env.NODE_ID ?? `node-${nanoid(8)}`,
  dbPath: process.env.DB_PATH ?? "./data/harness.db",
  auth: loadAuth(),
  // Static shared secret for machine-to-machine sync between nodes (optional).
  // Browser clients authenticate via login sessions, never with this token.
  authToken: (process.env.HARNESS_TOKEN ?? "").trim(), // empty = no peer token
  openrouter: {
    apiKey: (process.env.OPENROUTER_API_KEY ?? "").trim(),
    baseUrl: "https://openrouter.ai/api/v1",
    siteUrl: process.env.OR_SITE_URL ?? "http://localhost:8787",
    appTitle: process.env.OR_APP_TITLE ?? "AI Harness",
  },
    snapshots: {
    intervalMin: Number(process.env.SNAPSHOT_INTERVAL_MIN ?? 0), // 0 = disabled
    keep: Number(process.env.SNAPSHOT_KEEP ?? 20),
    dir: process.env.SNAPSHOT_DIR ?? "./data/snapshots",
    mirrorDir: (process.env.SNAPSHOT_MIRROR_DIR ?? "").trim(),   // "" = disabled
  },

  tavily: {
    apiKey: (process.env.TAVILY_API_KEY ?? "").trim(), // empty = web_search tool off
  },

  // Tool registry file (FUTUREHANDOFF P3): MCP servers declared here are
  // hot-swapped on change, no restart.
  toolsFile: process.env.TOOLS_FILE ?? "./config/tools.json",

  // H4 budgets. Rate limits are per-user token buckets on /api/* (owner
  // exempt); maxTokensPerRun caps generation size per provider call and
  // maxTokensPerDay is a global daily ceiling on billed tokens (owner
  // included: it protects the shared OpenRouter account, not user fairness).
  // Both are optional, 0 = disabled.
  budget: {
    ratePerMinUser: Number(process.env.RATE_PER_MIN_USER ?? 60),
    ratePerMinAdmin: Number(process.env.RATE_PER_MIN_ADMIN ?? 120),
    maxTokensPerRun: Number(process.env.MAX_TOKENS_PER_RUN ?? 0),
    maxTokensPerDay: Number(process.env.MAX_TOKENS_PER_DAY ?? 0),
  },

  b2: {
    enabled: Boolean(process.env.B2_KEY_ID && process.env.B2_APP_KEY && process.env.B2_BUCKET && process.env.B2_ENDPOINT),
    keyId: process.env.B2_KEY_ID ?? "",
    appKey: process.env.B2_APP_KEY ?? "",
    bucket: process.env.B2_BUCKET ?? "",
    endpoint: process.env.B2_ENDPOINT ?? "",
    region: process.env.B2_REGION ?? "auto",
  },

} as const;
