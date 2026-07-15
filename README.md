# hAIrness

> A self-hosted, single-process personal AI studio.
> Multi-model chat via OpenRouter, per-call system prompt override, skills, persistent memory,
> multi-agent pipelines & juries, code execution in the browser, automatic backups.

Built to run on a small Debian LXC (Proxmox), reachable over VPN. One process, one port, one SQLite file.

---

## Screenshots

<!-- commit your PNGs into docs/ and they will show up here -->
| Chat | Node graphs |
|------|-------------|
| ![Chat](docs/chat.png) | ![Nodes](docs/nodes.png) |

---

## Features

- **Chat** with any OpenRouter model, live SSE streaming, cost & cached-token metadata per message
- **System override per call** — `append` your instructions to the base prompt, or `replace` it entirely
- **Memory** — `soul` files (stable, cacheable prompt prefix) + `facts` (injected on demand)
- **Skills** — reusable instruction sets, toggled per chat
- **Projects** — bundle model + soul + facts + skills into a scope, applied in one click
- **Node graphs** — `pipeline` (A→B→C) and `jury` (N models answer in parallel, a judge scores and
  picks a winner); juries can be embedded as pipeline steps; every run is persisted
- **Code execution client-side** — JavaScript in a sandboxed iframe, Python via Pyodide; run button on every code block
- **Attachments** — images (vision models) and text/code files, drag & drop or paste
- **Backups** — WAL-safe hot snapshots on a schedule, mirrored outside the repo, optional Backblaze B2 upload
- **Multi-node sync** — pull/push deltas between peers, last-write-wins
- **PWA** — installable, mobile layout with toggleable panels
- API keys live **server-side only**, never in the browser

## Stack

| Layer    | Choice |
|----------|--------|
| Backend  | Node 20+ · Hono · better-sqlite3 · tsx (no build step) |
| Frontend | React 18 · Vite 6 · TypeScript · Zustand · Shiki |
| Database | SQLite, single file (`data/harness.db`) |
| Provider | OpenRouter (OpenAI-compatible), more adapters planned |

Single process serving API + static frontend on port **8787**.

## Requirements

- Node.js **20+** (18 will not work)
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
| `TAVILY_API_KEY` | optional, reserved for the web_search tool |
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

Everything lives in **one file**: `data/harness.db` — projects, skills, memory (soul/facts),
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
systemctl stop deployharness.service
cp /root/hAIrness/.env /root/env.backup
cd /root && rm -rf hAIrness
git clone https://github.com/LoreRuff/hAIrness.git
cd hAIrness/
cp /root/env.backup .env 2>/dev/null || cp .env.example .env
mkdir -p data && cp /root/harness-backups/harness-latest.db data/harness.db 2>/dev/null
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

## Architecture

```
browser (React PWA)
   │  SSE / JSON  — bearer token optional
   ▼
Node 20 (Hono, single process :8787)
   ├─ /api/chat          SSE relay → OpenRouter (keys server-side)
   ├─ /api/graph/run     pipeline & jury runner (SSE)
   ├─ /api/*             CRUD: skills, memory, projects, conversations, graphs, runs, prefs
   ├─ /api/sync/*        snapshots + peer pull/push (last-write-wins)
   └─ web/dist           static frontend
   ▼
SQLite (data/harness.db, WAL) ──► snapshots ──► mirror dir / Backblaze B2
```

- `shared/types.ts` is the single contract between server and web — change it first, code second.
- The system prompt is assembled server-side: `base (or replace) → soul → facts → skills`,
  keeping a stable prefix for provider prompt caching.

## Development

```bash
npm run dev   # server (tsx watch) + Vite dev server on :5173 with /api proxy
```

The server runs directly through `tsx` (no build step); only the frontend is built into `web/dist`.
If `web/dist` is missing, the server serves a built-in test page to verify the OpenRouter relay.

## Roadmap

- [ ] `web_search` tool + tool loop
- [ ] `blended` & `orchestrator` node types; run graphs from chat
- [ ] Direct provider adapters (Anthropic / OpenAI / Gemini / custom baseURL)
- [ ] Container runtime: real shell tools in ephemeral containers, Git-linked projects
- [ ] Sync delete propagation (tombstones)
- [ ] Conversation rename/delete, model-generated titles

## License

[AGPL-3.0](LICENSE) — © LoreRuff
