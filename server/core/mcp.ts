import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

// Minimal MCP (Model Context Protocol) client over stdio, zero deps.
// The wire is newline-delimited JSON-RPC 2.0 (MCP stdio transport). We only
// need initialize → tools/list → tools/call; any server request we cannot
// serve gets a method-not-found error so the protocol never stalls.

export interface McpServerCfg {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface Conn {
  proc: ChildProcess;
  nextId: number;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  tools: McpTool[];
  dead: boolean;
}

const connections = new Map<string, Conn>();

function rpc(conn: Conn, method: string, params?: unknown, timeoutMs = 15000): Promise<any> {
  const id = conn.nextId++;
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.pending.delete(id);
      reject(new Error(`mcp: timeout on ${method}`));
    }, timeoutMs);
    conn.pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    conn.proc.stdin!.write(msg + "\n");
  });
}

async function start(name: string, cfg: McpServerCfg): Promise<Conn> {
  const proc = spawn(cfg.command, cfg.args ?? [], {
    cwd: cfg.cwd || undefined,
    env: { ...process.env, ...(cfg.env ?? {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const conn: Conn = { proc, nextId: 1, pending: new Map(), tools: [], dead: false };

  createInterface({ input: proc.stdout! }).on("line", (line) => {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id != null && conn.pending.has(msg.id)) {
      const p = conn.pending.get(msg.id)!;
      conn.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`mcp ${name}: ${msg.error.message ?? JSON.stringify(msg.error)}`));
      else p.resolve(msg.result);
    }
    // Server→client requests (sampling, roots, ...): refuse politely.
    if (msg.method && msg.id != null) {
      proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not supported" } }) + "\n");
    }
  });
  proc.stderr!.on("data", (d) => console.error(`[mcp:${name}]`, String(d).trim()));
  proc.on("exit", () => {
    conn.dead = true;
    for (const p of conn.pending.values()) p.reject(new Error(`mcp ${name}: server exited`));
    conn.pending.clear();
    if (connections.get(name) === conn) connections.delete(name);
  });

  await rpc(conn, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "hAIrness", version: "1.0.0" },
  });
  proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const res = await rpc(conn, "tools/list");
  conn.tools = (res?.tools ?? []) as McpTool[];
  return conn;
}

/** Live tool list for one server; starts or reuses the connection. */
export async function mcpListTools(name: string, cfg: McpServerCfg): Promise<McpTool[]> {
  let conn = connections.get(name);
  if (!conn || conn.dead) {
    if (conn) { try { conn.proc.kill(); } catch { /* already gone */ } }
    conn = await start(name, cfg);
    connections.set(name, conn);
  }
  return conn.tools;
}

/** Execute one tool; a broken connection is respawned once before failing. */
export async function mcpCallTool(
  name: string, cfg: McpServerCfg, tool: string, args: Record<string, unknown>, timeoutMs = 60000
): Promise<string> {
  let conn = connections.get(name);
  if (!conn || conn.dead) {
    conn = await start(name, cfg);
    connections.set(name, conn);
  }
  try {
    const res = await rpc(conn, "tools/call", { name: tool, arguments: args }, timeoutMs);
    const parts = (res?.content ?? []) as { type: string; text?: string }[];
    return parts.filter((p) => p.type === "text" && p.text != null).map((p) => p.text).join("\n") || "(empty result)";
  } catch (e) {
    // One retry on a fresh connection: covers crashed servers (exit handler
    // already dropped the dead conn from the map).
    if (conn.dead) {
      const fresh = await start(name, cfg);
      connections.set(name, fresh);
      const res = await rpc(fresh, "tools/call", { name: tool, arguments: args }, timeoutMs);
      const parts = (res?.content ?? []) as { type: string; text?: string }[];
      return parts.filter((p) => p.type === "text" && p.text != null).map((p) => p.text).join("\n") || "(empty result)";
    }
    throw e;
  }
}

export function mcpShutdown(): void {
  for (const [, c] of connections) { try { c.proc.kill(); } catch { /* gone */ } }
  connections.clear();
}
