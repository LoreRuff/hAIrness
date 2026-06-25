import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { config } from "./config.ts";
import { db } from "./db.ts";              // side-effect: opens DB + runs migrations
import { chat } from "./router/chat.ts";
import { models } from "./router/models.ts";

const app = new Hono();

// --- API ---
const api = new Hono();

api.get("/health", (c) =>
  c.json({
    ok: true,
    nodeId: config.nodeId,
    hasKey: Boolean(config.openrouter.apiKey),
    time: Date.now(),
  })
);

api.route("/chat", chat);
api.route("/models", models);

app.route("/api", api);

// --- Static frontend (production build) ---
const WEB_DIST = "./web/dist";
const hasBuild = existsSync(`${WEB_DIST}/index.html`);

if (hasBuild) {
  app.use("/*", serveStatic({ root: WEB_DIST }));
  // SPA fallback: any non-api route -> index.html
  app.get("*", serveStatic({ path: `${WEB_DIST}/index.html` }));
} else {
  // No React build yet -> serve a minimal test chat page so you can verify OpenRouter.
  app.get("/", (c) => c.html(TEST_PAGE));
}

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[harness] listening on http://${config.host}:${info.port}`);
  console.log(`[harness] node=${config.nodeId} key=${config.openrouter.apiKey ? "set" : "MISSING"}`);
  if (!hasBuild) console.log(`[harness] no web/dist build -> serving built-in test page at /`);
});

// ----------------------------------------------------------------------------
// Minimal built-in test page (only used when web/dist is not built yet).
// Lets you verify the SSE relay + OpenRouter key without the React app.
// ----------------------------------------------------------------------------
const TEST_PAGE = /* html */ `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Harness — test</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0d1117;color:#c9d1d9;margin:0;padding:20px;line-height:1.5}
  h1{font-size:17px}.muted{color:#8b949e;font-size:13px}
  #log{white-space:pre-wrap;background:#11161d;border:1px solid #222b36;border-radius:8px;padding:12px;min-height:200px;font-family:ui-monospace,Menlo,monospace;font-size:13px;margin:12px 0}
  textarea,select,input{background:#161b22;color:#c9d1d9;border:1px solid #222b36;border-radius:6px;padding:8px;font:inherit}
  textarea{width:100%;min-height:60px}
  .row{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}
  button{background:#58a6ff;color:#0a0d12;border:none;border-radius:6px;padding:8px 16px;font-weight:600;cursor:pointer}
  label{font-size:13px;color:#8b949e}
</style></head>
<body>
  <h1>AI Harness — built-in test page</h1>
  <p class="muted">No React build yet. This page hits <code>/api/chat</code> (SSE) to verify OpenRouter works.</p>
  <div class="row">
    <label>Model</label>
    <input id="model" value="openai/gpt-4o-mini" style="width:240px">
    <label>System mode</label>
    <select id="mode"><option value="append">append</option><option value="replace">replace</option></select>
  </div>
  <div class="row" style="width:100%">
    <input id="system" placeholder="custom system instructions (optional)" style="flex:1">
  </div>
  <textarea id="prompt" placeholder="Type a message...">Say hello in one short sentence.</textarea>
  <div class="row"><button id="send">Send ▸</button> <span id="status" class="muted"></span></div>
  <div id="log"></div>

<script>
const $ = (id) => document.getElementById(id);
$("send").onclick = async () => {
  const log = $("log"); log.textContent = "";
  $("status").textContent = "connecting...";
  const payload = {
    model: $("model").value.trim(),
    systemMode: $("mode").value,
    system: $("system").value.trim() || undefined,
    stream: true,
    messages: [{ id: "u1", role: "user", content: $("prompt").value, createdAt: Date.now() }]
  };
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok || !res.body) { log.textContent = "HTTP " + res.status; $("status").textContent=""; return; }
    $("status").textContent = "streaming...";
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const raw = t.slice(5
