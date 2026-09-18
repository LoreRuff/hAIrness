// ============================================================
// Variable template engine — shared by runner (server) and canvas (web)
// ============================================================
// The "lightweight hybrid" state of the playground: nodes reference run
// variables with {{key}} placeholders instead of a stateful engine.
// Keys are flat: "var.x" for run inputs, "<nodeRef>.output" for node
// results (nodeRef = node id or slugified node name). One regex, no
// nesting: the map of variables IS the scratchpad, so a missing key is
// a correctness error (fail fast with the key name), never a silent "".
import type { AgentNode } from "./types.ts";

const PLACEHOLDER = /\{\{\s*([^{}\s]+)\s*\}\}/g;

// Node names become readable aliases: "Curatore 1" -> curatore_1.output.
export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node";
}

export function resolveTemplate(text: string | undefined, vars: Map<string, string>): string {
  if (!text) return "";
  return text.replace(PLACEHOLDER, (_m, key: string) => {
    const v = vars.get(key);
    if (v === undefined) throw new Error(`unresolved variable {{"${key}"}}`);
    return v;
  });
}

// Placeholder keys a text references — the UI lists these as hints next
// to the run input so users never guess key names.
export function collectPlaceholders(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// Every key a node may reference: run vars + upstream outputs (id and
// name alias). Called by the UI hint and by validation before a run.
export function availableKeys(
  node: AgentNode,
  vars: Map<string, string>,
  outputs: Map<string, string>,
  nodesById: Map<string, AgentNode>
): string[] {
  const keys = [...vars.keys()];
  for (const [id] of outputs) {
    keys.push(`${id}.output`);
    const n = nodesById.get(id);
    if (n?.name) keys.push(`${slugify(n.name)}.output`);
  }
  return keys;
}
