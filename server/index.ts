import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { config } from "./config.ts";
import { chat } from "./router/chat.ts";
import { models } from "./router/models.ts";
import { crudRouter } from "./router/crud.ts";

// ---------- built-in test page (declared FIRST — hoisting lesson learned) ----------
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
    <label>Token</label>
    <input id="token" placeholder="HARNESS_TOKEN (if set)" style="width:200px">
  </div>
  <div class="row" style="width:100%">
    <input id="system" placeholder="custom system instructions (optional)" style="flex:1">
  </div>
  <textarea id="prompt" placeholder="Type a message...">Say hello in one short sentence.</textarea>
  <div class="row"><button id="send">Send &#9658;</button> <span id="status" class="muted"></span></div>
  <div id="log"></div>

<script>
const $ = (id) => document.getElementById(id);
$("token").value = localStorage.getItem("harness_token") || "";
$("send").onclick = async () => {
  const log = $("log"); log.textContent = "";
  $("status").textContent = "connecting...";
  localStorage.setItem("harness_token", $("token").value.trim());
  const payload = {
    model: $("model").value.trim(),
    systemMode: $("mode").value,
    system: $("system").value.trim() || undefined,
    stream: true,
    messages: [{ id: "u1", role: "user", content: $("prompt").value, createdAt: Date.now() }]
  };
  const headers = { "Content-Type": "application/json" };
  if ($("token").value.trim()) headers["Authorization"] = "Bearer " + $("token").value.trim();
  try {
    const res = await fetch("/api/chat", { method: "POST", headers, body: JSON.stringify(payload) });
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
        const raw = t.slice(5).trim();
        if (!raw) continue;
        try {
          const ev = JSON.parse(raw);
          if (ev.type === "token") log.textContent += ev.text;
          else if (ev.type === "usage") $("status").textContent =
            "tokens " + ev.usage.promptTokens + "/" + ev.usage.completionTokens +
            " · cached " + ev.usage.cachedPct + "% · $" + ev.usage.costUsd.toFixed(5);
          else if (ev.type === "error") log.textContent += "\\n[error] " + ev.message;
          else if (ev.type === "done") $("status").textContent += " · done";
        } catch (_) {}
      }
    }
  } catch (e) {
    log.textContent = "fetch error: " + e;
    $("status").textContent = "";
  }
};
</script>
</body></html>`;

// ---------- app ----------
const app = new Hono();

// auth middleware (only if HARNESS_TOKEN is set; /api/health always open)
app.use("/api/*", async (c, next) => {
  if (!config.authToken || c.req.path === "/api/health") return next();
  const h = c.req.header("Authorization") ?? "";
  const got = h.startsWith("Bearer ") ? h.slice(7) : "";
  const a = Buffer.from(got);
  const b = Buffer.from(config.authToken);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) return c.json({ error: "unauthorized" }, 401);
  return next();
});

app.get("/api/health", (c) =>
  c.json({ ok: true, nodeId: config.nodeId, hasKey: Boolean(config.openrouter.apiKey), time: Date.now() })
);

app.route("/api/chat", chat);
app.route("/api/models", models);
app.route("/api/skills", crudRouter("skills"));
app.route("/api/memory", crudRouter("memory_files"));
app.route("/api/projects", crudRouter("projects"));
app.route("/api/conversations", crudRouter("conversations"));

// static frontend (web/dist) with SPA fallback; test page if no build yet
const DIST = "./web/dist";
const hasDist = existsSync(`${DIST}/index.html`);

if (hasDist) {
  app.use("/*", serveStatic({ root: DIST }));
  const indexHtml = readFileSync(`${DIST}/index.html`, "utf8");
  app.get("*", (c) => c.html(indexHtml)); // SPA fallback
} else {
  app.get("*", (c) => c.html(TEST_PAGE));
}

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[harness] node=${config.nodeId} listening on http://${config.host}:${info.port}`);
  console.log(`[harness] frontend: ${hasDist ? "web/dist" : "built-in test page"} · auth: ${config.authToken ? "ON" : "off"} · key: ${config.openrouter.apiKey ? "present" : "MISSING"}`);
});
