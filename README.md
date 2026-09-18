# hAIrness

> A self-hosted, single-process personal AI studio.
> Multi-model chat via OpenRouter, per-call system prompt override, reusable personas, skills,
> persistent memory, granular multi-agent DAG graphs, code execution in the browser, automatic backups.

Built to run on a small Debian LXC (Proxmox), reachable over VPN. One process, one port, one SQLite file.

---

## Features

- **Chat** with any OpenRouter model, live SSE streaming, cost & cached-token metadata per message
- **Tool loop** — skills can declare `web_search` (Tavily): the model requests searches, the server
  executes them and feeds results back (max 4 rounds); calls/results stream live into the chat
- **Thinking view** — reasoning/CoT deltas stream into a collapsible 💭 block (display-only, never resent)
- **Configurable context window** — send only the last N messages; older history is folded into an
  auto-generated rolling summary (cached per dropped span)
- **System override per call** — `append` your instructions to the base prompt, or `replace` it entirely
- **Memory** — `soul` files (stable, cacheable prompt prefix) + `facts` (injected on demand)
- **Skills** — reusable instruction sets, toggled per chat
- **Prompts (personas)** — reusable system-prompt cards, toggled per chat and attachable to individual graph nodes
- **Projects** — bundle model + soul + facts + skills into a scope, applied in one click
- **Node graphs** — granular DAG editor on a React Flow canvas: place `single` and `jury` nodes,
  wire them freely (cycles rejected at connect time), run live with per-node streaming;
  templates for chain / jury / jury+refine; legacy pipelines and juries are converted on read;
  every run is persisted
- **Code execution client-side** — JavaScript in a sandboxed iframe, Python via Pyodide; run button on every code block
- **Attachments** — images (vision models) and text/code files, drag & drop or paste
- **Fast UX** — Ctrl/Cmd+K palette (jump to any view, conversation or graph; toggle personas),
  context chips bar with a list-style picker, conversation rename/delete in the sidebar
- **Backups** — WAL-safe hot snapshots on a schedule, mirrored outside the repo, optional Backblaze B2 upload
- **Multi-node sync** — pull/push deltas between peers, last-write-wins
- **PWA** — installable, mobile layout with toggleable panels
- API keys live **server-side only**, never in the browser

## Stack

| Layer    | Choice |
|----------|--------|
| Backend  | Node 20+ · Hono · better-sqlite3 · tsx (no build step) |
| Frontend | React 18 · Vite 6 · TypeScript · Zustand · Shiki · React Flow |
| Database | SQLite, single file (`data/harness.db`) |
| Provider | OpenRouter (OpenAI-compatible), more adapters planned |

Single process serving API + static frontend on port **8787**.

## Requirements

- Node.js **20+**
- ~2 GB RAM / 2 vCPU / 8 GB disk
- An [OpenRouter](https://openrouter.ai) API key

## Install

```bash
git clone https://github.com/LoreRuff/hAIrness.git
cd hAIrness/

npm install
npm run build
```

### Configure

`.env` is the configuration file. On first setup:

```bash
cp .env.example .env
nano .env
```

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | your key — stays server-side |
| `PORT` / `HOST` | default `8787` / `0.0.0.0` |
| `NODE_ID` | unique name for this machine (used by sync) |
| `HARNESS_TOKEN` | optional bearer token for the API (`openssl rand -hex 24`); empty = auth off |
| `SNAPSHOT_INTERVAL_MIN` | automatic DB snapshots, minutes (`0` = off) |
| `SNAPSHOT_KEEP` | how many snapshots to retain |
| `SNAPSHOT_MIRROR_DIR` | external dir for snapshot copies (survives redeploys), e.g. `/root/harness-backups` |
| `B2_KEY_ID` `B2_APP_KEY` `B2_BUCKET` `B2_ENDPOINT` `B2_REGION` | optional Backblaze B2 upload (requires `npm i @aws-sdk/client-s3`) |
| `TAVILY_API_KEY` | optional, enables the `web_search` tool for skills that declare it |
| `OR_SITE_URL` / `OR_APP_TITLE` | optional OpenRouter attribution headers |
| `DB_PATH` | SQLite file location, default `./data/harness.db` |

### Test run

```bash
npm start
# then: curl http://localhost:8787/api/health
```

### Run as a service (systemd)

> Paths below assume the repo lives in `/root/hAIrness` — adjust `WorkingDirectory`
> in the unit file and the paths if you use a different user/home.

```bash
cp /root/hAIrness/deployharness.service /etc/systemd/system/deployharness.service
systemctl daemon-reload
systemctl enable --now deployharness.service
```

The app is now at `http://<host>:8787`.

## Backup & restore

Everything lives in **one file**: `data/harness.db` — projects, skills, prompts, memory (soul/facts),
conversations, node graphs, graph runs and UI preferences. Config lives in `.env`.

With `SNAPSHOT_INTERVAL_MIN` and `SNAPSHOT_MIRROR_DIR` set, consistent hot snapshots (WAL-safe)
are taken automatically and mirrored outside the repo, including an always-current
`harness-latest.db`. A manual **snapshot now** button is available in Settings, plus full
JSON export/import of all data.

**Restore:**

```bash
systemctl stop deployharness.service
cp /root/harness-backups/harness-latest.db /root/hAIrness/data/harness.db
systemctl start deployharness.service
```

**Redeploy from scratch:**

```bash
# backup first
systemctl stop deployharness.service
mkdir -p /root/harness-backups
cp /root/hAIrness/data/harness.db /root/harness-backups/harness-pre-redeploy.db
cp /root/hAIrness/.env /root/env.backup

# redeploy
cd /root && rm -rf hAIrness
git clone https://github.com/LoreRuff/hAIrness.git
cd hAIrness/
cp /root/env.backup .env 2>/dev/null || cp .env.example .env
mkdir -p data && cp /root/harness-backups/harness-pre-redeploy.db data/harness.db 2>/dev/null
npm install
npm run build
systemctl restart deployharness.service
```

## Security notes

- Designed to be reachable **over VPN only** (e.g. WireGuard). Do not expose it to the public internet.
- Optional API auth via `HARNESS_TOKEN` (timing-safe bearer check).
- API keys never reach the browser; all provider calls are relayed server-side.
- Code blocks run **client-side** (sandboxed iframe / Pyodide) — nothing executes on the server.
- PWA install requires a secure context: either HTTPS via a reverse proxy (e.g. Caddy with
  `tls internal`) or a browser flag for your VPN origin.
- If a future version ever needs looser exposure than this (public internet, more client
  surface), this section changes first.

## Architecture

```
browser (React PWA)
   │  SSE / JSON  — bearer token optional
   ▼
Node 20 (Hono, single process :8787)
   ├─ /api/chat          SSE relay → OpenRouter (keys server-side)
    ├─ /api/graph/run     DAG runner: single & jury nodes, topo order (SSE)
    ├─ /api/*             CRUD: skills, prompts, memory, projects, conversations, graphs, runs, prefs
   ├─ /api/sync/*        snapshots + peer pull/push (last-write-wins)
   └─ web/dist           static frontend (generated by `npm run build`, not in the repo)
   ▼
SQLite (data/harness.db, WAL) ──► snapshots ──► mirror dir / Backblaze B2
```

- `shared/types.ts` is the single contract between server and web — change it first, code second.
- `shared/graph.ts` is shared runner/editor logic: legacy graph → DAG normalization and cycle-checked
  topological order, used by the server *and* the web canvas.
- The system prompt is assembled server-side: `base (or replace) → personas → soul → facts → skills`,
  keeping a stable prefix for provider prompt caching.

## Development

```bash
npm run dev   # server (tsx watch) + Vite dev server on :5173 with /api proxy
npm run check # typecheck (tsc --noEmit) — must stay clean
bun test      # pure-logic tests (shared/graph.test.ts) — no extra deps, bun is only the runner
```

The server runs directly through `tsx` (no build step); only the frontend is built into `web/dist`.
If `web/dist` is missing, the server serves a built-in test page to verify the OpenRouter relay.

## Before a release

`npm run check` must be clean and `bun test` green, then exercise the paths that historically break
(on the real deployment, not just localhost):

- `curl http://localhost:8787/api/health`
- one chat: SSE stream renders, usage (tokens/cost/cached%) persists on the message
- attachments: one image (vision model) + one text file
- one graph built **before the DAG editor** (legacy pipeline or jury): it must still run after
  on-read normalization — this migration path is pinned in `shared/graph.test.ts`
- a DAG graph on the canvas: node glow follows `node_start`/`node_done`, a jury's scores and
  winner persist in runs, multiple end nodes render as numbered outputs
- one chat with a skill that declares `web_search` (TAVILY_API_KEY set): the tool_call chip
  renders, the tool result box appears, the final answer uses the results, usage is summed
- snapshot → restore roundtrip (boot from the `SNAPSHOT_MIRROR_DIR` copy)
- sync pull/push between two nodes (last-write-wins on a conflicting row)

## Roadmap

**Chat & prompts**
- [x] `web_search` tool + tool loop (Tavily; Google search API as alternative provider — TODO)
- [x] Show chain-of-thought / thinking tokens in chat (collapsible)
- [x] Configurable context window (send last N messages; rolling summary)
- [ ] Model-generated conversation titles

**Node graphs**
- [ ] `blended` & `orchestrator` node types (declared in types, not yet run); run graphs from chat

**Providers & infra**
- [ ] Direct provider adapters (Anthropic / OpenAI / Gemini / custom baseURL)
- [ ] Container runtime: real shell tools in ephemeral containers, Git-linked projects
- [ ] Sync delete propagation (tombstones)
- [ ] Export / import of skills and soul facts

**UI**
- [ ] Replace the Inspector's checkbox groups with the same chips + list picker used in chat

## License

[AGPL-3.0](LICENSE) — © LoreRuff

---

Developed with strong AI assistance (opencode/GLM); humans led the ideas, the
testing and the debugging — said openly because it shaped how the project was
built.
