#!/usr/bin/env node
// Demo MCP server (stdio) — zero deps, for testing hAIrness MCP tool wiring.
// Run standalone: node tools/demo-mcp.mjs  (or point config/tools.json at it).
// Exposes: echo (repeats text), add (sums two numbers).

import { createInterface } from "node:readline";

const TOOLS = [
  {
    name: "echo",
    description: "Echoes the given text back. Useful to verify the tool pipeline works.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Text to echo" } },
      required: ["text"],
    },
  },
  {
    name: "add",
    description: "Adds two numbers and returns the sum.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "First addend" },
        b: { type: "number", description: "Second addend" },
      },
      required: ["a", "b"],
    },
  },
];

function handle(name, args) {
  if (name === "echo") {
    if (typeof args.text !== "string") throw new Error("missing required string argument 'text'");
    return `echo: ${args.text}`;
  }
  if (name === "add") {
    const a = Number(args.a), b = Number(args.b);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("'a' and 'b' must be numbers");
    return `${a} + ${b} = ${a + b}`;
  }
  throw new Error(`unknown tool "${name}"`);
}

const rl = createInterface({ input: process.stdin });
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

rl.on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id == null) return; // notification: nothing to answer
  try {
    let result;
    if (msg.method === "initialize") {
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "hAIrness-demo", version: "1.0.0" },
      };
    } else if (msg.method === "tools/list") {
      result = { tools: TOOLS };
    } else if (msg.method === "tools/call") {
      try {
        result = { content: [{ type: "text", text: handle(msg.params?.name, msg.params?.arguments ?? {}) }] };
      } catch (e) {
        result = { content: [{ type: "text", text: `error: ${e.message}` }], isError: true };
      }
    } else {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method "${msg.method}" not found` } });
      return;
    }
    send({ jsonrpc: "2.0", id: msg.id, result });
  } catch (e) {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(e.message ?? e) } });
  }
});
