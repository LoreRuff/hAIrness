import { graph } from "./router/graph.ts";
import { db } from "./db.ts";
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { config } from "./config.ts";
import { chat } from "./router/chat.ts";
import { models } from "./router/models.ts";
import { crudRouter } from "./router/crud.ts";
import { harnesses } from "./router/harnesses.ts";
import { sync } from "./router/sync.ts";
import { startSnapshotScheduler } from "./core/snapshot.ts";
import { prefs } from "./router/prefs.ts";
import { memory } from "./router/memory.ts";
import { auth } from "./router/auth.ts";
import { users } from "./router/users.ts";
import { safeEqual, sessionOf, type Env, type Subject } from "./core/auth.ts";
import { rateLimit } from "./core/budget.ts";
import { availableTools } from "./core/tools.ts";
import { metrics, abandonStalePausedRuns } from "./db.ts";

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
    <label>User</label>
    <input id="user" placeholder="HARNESS_USER" style="width:130px">
    <label>Password</label>
    <input id="pass" type="password" placeholder="HARNESS_PASSWORD" style="width:180px">
  </div>
  <div class="row" style="width:100%">
    <input id="system" placeholder="custom system instructions (optional)" style="flex:1">
  </div>
  <textarea id="prompt" placeholder="Type a message...">Say hello in one short sentence.</textarea>
  <div class="row"><button id="send">Send &#9658;</button> <span id="status" class="muted"></span></div>
  <div id="log"></div>

<script>
const $ = (id) => document.getElementById(id);
async function ensureToken() {
  const saved = localStorage.getItem("harness_token");
  if (saved) return saved;
  const r = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: $("user").value.trim(), password: $("pass").value.trim() }) });
  if (!r.ok) throw new Error("login failed: HTTP " + r.status);
  const j = await r.json();
  localStorage.setItem("harness_token", j.token);
  return j.token;
}
$("send").onclick = async () => {
  const log = $("log"); log.textContent = "";
  $("status").textContent = "connecting...";
  try {
    const token = await ensureToken();
    const payload = {
      model: $("model").value.trim(),
      systemMode: $("mode").value,
      system: $("system").value.trim() || undefined,
      stream: true,
      messages: [{ id: "u1", role: "user", content: $("prompt").value, createdAt: Date.now() }]
    };
    const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + token };
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
const app = new Hono<Env>();

// H2: auth is always on. Two accepted credentials only: a login session token
// (browser) or the optional static peer token (machine-to-machine sync).
// /api/health and /api/auth stay open. The resolved subject travels with the
// request as c.get("user") for attribution and quota enforcement (P4).
app.use("/api/*", async (c, next) => {
  const p = c.req.path;
  if (p === "/api/health" || p === "/api/auth" || p.startsWith("/api/auth/")) return next();
  const h = c.req.header("Authorization") ?? "";
  const got = h.startsWith("Bearer ") ? h.slice(7) : "";
  const subject: Subject | null = sessionOf(got) ??
    (Boolean(config.authToken) && safeEqual(got, config.authToken)
      ? { username: "peer", role: "admin" }
      : null);
  if (!subject) return c.json({ error: "unauthorized" }, 401);
  const rl = rateLimit(subject);
  if (!rl.ok) return c.json({ error: "rate limit exceeded", retryAfter: rl.retryAfter }, 429);
  c.set("user", subject);
  return next();
});

app.get("/api/health", (c) =>
  c.json({ ok: true, nodeId: config.nodeId, hasKey: Boolean(config.openrouter.apiKey), time: Date.now() })
);

app.route("/api/chat", chat);
app.route("/api/models", models);
app.route("/api/auth", auth);
app.route("/api/users", users);
app.route("/api/skills", crudRouter("skills"));
app.route("/api/prompts", crudRouter("prompts"));
app.route("/api/memory", crudRouter("memory_files"));
app.route("/api/projects", crudRouter("projects"));
app.route("/api/conversations", crudRouter("conversations"));
app.route("/api/graphs", crudRouter("graphs"));
app.route("/api/harnesses", harnesses);
// Mounted separately from crud /api/memory: POST /analyze must not collide
// with the generic row-create POST on memory_files (N3 auto-memory).
app.route("/api/memory-analysis", memory);
app.route("/api/sync", sync);
app.route("/api/graph", graph);
app.route("/api/runs", crudRouter("graph_runs"));
app.route("/api/benchmarks", crudRouter("benchmarks"));
app.route("/api/prefs", prefs);

// T-04/T-19: aggregated per-call metrics (SQL views over tasks/tool_events).
// Global spend view: admins and owner only (P4 "see but not manage" — a plain
// user must not enumerate other users' usage).
app.get("/api/metrics", (c) => {
  const role = c.get("user")?.role;
  if (role !== "owner" && role !== "admin") return c.json({ error: "admin only" }, 403);
  return c.json(metrics());
});

// R-B: the Skills editor hints these (click-to-insert); without it users can
// only guess which wire names exist (web_search + mcp_* discovery is invisible).
app.get("/api/tools", (c) => c.json({ tools: availableTools() }));


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
  console.log(`[harness] frontend: ${hasDist ? "web/dist" : "built-in test page"} · auth: login ON (user=${config.auth.user}) · peer token: ${config.authToken ? "set" : "none"} · key: ${config.openrouter.apiKey ? "present" : "MISSING"}`);
  const stale = abandonStalePausedRuns();
  if (stale) console.log(`[harness] abandoned ${stale} stale paused run(s) (>24h)`);
startSnapshotScheduler();
function shutdown() {
  try { db.close(); } catch {}   // closes + checkpoints WAL
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
});
