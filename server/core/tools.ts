import { readFileSync, watch } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.ts";
import type { ToolName } from "../../shared/types.ts";
import { mcpListTools, mcpCallTool, type McpServerCfg, type McpTool } from "./mcp.ts";

// ---- MCP tool provider (spec P3: registry on file, MCP as tool provider) ----
// config/tools.json declares MCP servers; their tools are auto-discovered via
// tools/list and exposed to the model as mcp_<server>_<tool>. The file is
// watched: editing it swaps tools without restarting the server.

interface Registry {
  servers: Record<string, McpServerCfg>;
  tools: Map<string, { server: string; tool: McpTool }>;
}
const registry: Registry = { servers: {}, tools: new Map() };

function wireName(server: string, tool: string): string {
  // OpenAI function-name charset + 64-char cap.
  return `mcp_${server}_${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function readServers(): Record<string, McpServerCfg> {
  try {
    const j = JSON.parse(readFileSync(resolve(config.toolsFile), "utf8"));
    return (j.mcpServers ?? {}) as Record<string, McpServerCfg>;
  } catch { return {}; } // missing/broken file = builtin tools only
}

async function discoverMcpTools(): Promise<void> {
  for (const [name, cfg] of Object.entries(registry.servers)) {
    try {
      const tools = await mcpListTools(name, cfg);
      for (const [k, v] of registry.tools) if (v.server === name) registry.tools.delete(k);
      for (const t of tools) registry.tools.set(wireName(name, t.name), { server: name, tool: t });
    } catch (e: any) {
      console.error(`[tools] mcp "${name}" discovery failed:`, e?.message ?? e);
    }
  }
}

export function reloadRegistry(): void {
  registry.servers = readServers();
  registry.tools.clear();
  void discoverMcpTools(); // async: discovered tools land a beat later
}

// Hot-swap: editors write in bursts, so debounce the reload.
let watchTimer: ReturnType<typeof setTimeout> | null = null;
try {
  watch(resolve(config.toolsFile), () => {
    if (watchTimer) clearTimeout(watchTimer);
    watchTimer = setTimeout(reloadRegistry, 500);
  });
  reloadRegistry();
} catch { /* no config dir: builtin tools only */ }

// Tool specs in OpenAI function-calling format. Only tools with a server-side
// executor are declared: the model must never see a tool we cannot run.
const SPECS: Record<string, unknown> = {
  web_search: {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web. Returns ranked results, each with title, url and a content snippet.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          max_results: {
            type: "number",
            description: "Maximum number of results, 1..10 (default 5)",
          },
        },
        required: ["query"],
      },
    },
  },
};

export function availableTools(): ToolName[] {
  const builtin: ToolName[] = config.tavily.apiKey ? ["web_search"] : [];
  return [...builtin, ...registry.tools.keys()];
}

export function toolSpecs(names: string[]): unknown[] {
  return names
    .filter((n) => availableTools().includes(n))
    .map((n) => {
      if (n === "web_search") return SPECS.web_search;
      const e = registry.tools.get(n);
      if (!e) return null;
      return {
        type: "function",
        function: {
          name: n,
          description: e.tool.description ?? `MCP tool ${e.tool.name} from server "${e.server}"`,
          parameters: e.tool.inputSchema ?? { type: "object", properties: {} },
        },
      };
    })
    .filter(Boolean);
}

export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export type ToolCallAccum = Map<number, { id: string; name: string; args: string }>;

// Streamed tool calls arrive as fragments split across chunks (OpenAI deltas
// are index-keyed; only the first fragment carries id/name, arguments concat).
export function applyToolCallDelta(
  calls: ToolCallAccum,
  tc: { index?: number; id?: string; function?: { name?: string; arguments?: string } }
): void {
  const i = tc.index ?? 0;
  const cur = calls.get(i) ?? { id: "", name: "", args: "" };
  if (tc.id) cur.id = tc.id;
  if (tc.function?.name) cur.name = tc.function.name;
  if (tc.function?.arguments) cur.args += tc.function.arguments;
  calls.set(i, cur);
}

// Parse and validate model-supplied tool arguments; throws on garbage so the
// caller can feed a structured error back to the model.
export function parseWebSearchArgs(args: Record<string, unknown>): {
  query: string;
  maxResults: number;
} {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) throw new Error("web_search: missing required string argument 'query'");
  return {
    query,
    maxResults: clampInt(args.max_results ?? args.maxResults, 1, 10, 5),
  };
}

export async function runTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  try {
    if (name === "web_search") {
      const { query, maxResults } = parseWebSearchArgs(args);
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.tavily.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, max_results: maxResults }),
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) {
        throw new Error(`tavily ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
      }
      const j: any = await r.json();
      // Keep only what the model needs (title/url/content): fewer tokens fed
      // back into the loop, same information.
      return (j.results ?? []).map((x: any) => ({
        title: x.title,
        url: x.url,
        content: x.content,
      }));
    }
    const e = registry.tools.get(name);
    if (!e) throw new Error(`unknown tool "${name}"`);
    return { content: await mcpCallTool(e.server, registry.servers[e.server], e.tool.name, args) };
  } catch (e: any) {
    // Tool failures go back to the model as a normal result, so it can adapt
    // or answer without the tool instead of killing the whole stream.
    return { error: String(e?.message ?? e) };
  }
}
