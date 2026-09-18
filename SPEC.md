# AI HARNESS — Build Spec v1.2 (as-built)

> Personal AI studio. Multi-provider (OpenRouter today), granular multi-agent DAG graphs
> (React Flow canvas), reusable personas, skills (instructions + declared tools),
> persistent memory (soul/facts), live SSE streaming + client-side inline code execution,
> jury panels, WAL-safe snapshots, multi-node sync. UI language: English.
> This SPEC describes the code **as it is** — see §11 for milestone status.
> Verify against `shared/types.ts` before extending anything.

---

## 0. Agent kickoff prompt (paste this first)

> You are extending "AI Harness", a personal AI studio that already runs — this
> SPEC is the as-built map. Read it entirely, then read shared/types.ts, before
> writing code. Work milestone by milestone, show me a runnable result before
> continuing. Hard rules: (1) API keys live server-side only, never in the
> browser. (2) The system prompt has a per-call override mode `append | replace`.
> (3) Persist token/cost/cached% metadata per message. (4) Nodes must run
> standalone AND sync. (5) Correctness before speed — no faster path with
> unexplained drift. (6) Typecheck warnings are build failures: `npm run check`
> (tsc --noEmit) must stay clean. (7) shared/types.ts is the contract — change
> it first, code second. (8) Legacy graph rows are normalized on read, never
> rewritten in the DB — the migration path is pinned in shared/graph.test.ts.

---

## 1. Stack

| Layer        | Choice                                   | Why |
|--------------|------------------------------------------|-----|
| Backend      | Node 20 + Hono, run via tsx (no build step) | tiny, runs in LXC/Proxmox |
| DB           | SQLite via better-sqlite3, WAL           | single file, hot snapshots |
| Snapshots    | WAL-safe `db.backup()` + mirror dir + Backblaze B2 via `@aws-sdk/client-s3` (S3 API, optional dep — see server/aws-sdk-fallback.d.ts) | durable, survives redeploys |
| Frontend     | React 18 + Vite 6 + TypeScript + Zustand + React Flow (@xyflow/react v12) | static build, granular node editor |
| Highlight    | Shiki (live streaming highlight)         | one highlighter, live — no Monaco |
| Streaming    | SSE from backend relay                   | keys stay server-side |
| Local exec   | iframe (JS) + Pyodide (Py) — client-side only | nothing executes on the server |
| Tests        | `bun test` (bun is only the runner — no test dep in the project) | pure logic: graph normalize/topo, the historic migration path |
| PWA          | `web/public/sw.js` + `manifest.json`     | installable |

---

## 2. File tree (as-built)

```
hAIrness/
├─ server/
│  ├─ index.ts              # Hono app: routes, static serve, SPA fallback + built-in test page
│  ├─ db.ts                 # SQLite init (WAL); row = { id, json, updatedAt, nodeOrigin }
│  ├─ config.ts             # env keys, NODE_ID, peers, B2 config
│  ├─ router/
│  │  ├─ chat.ts            # POST /api/chat (SSE relay → OpenRouter)
│  │  ├─ graph.ts           # POST /api/graph/run (SSE)
│  │  ├─ models.ts          # GET /api/models
│  │  ├─ crud.ts            # one generic CRUD router × 7 tables
│  │  ├─ prefs.ts           # GET|PUT UI preferences
│  │  └─ sync.ts            # pull / push / pull-from-peer / snapshot now / list
│  ├─ core/
│  │  ├─ openrouter.ts      # the only provider adapter (more planned)
│  │  ├─ promptBuilder.ts   # base(or replace) → personas → soul → facts → skills (+ attachments)
│  │  ├─ graphRunner.ts     # DAG runner: topo order, single / jury (blended, orchestrator: planned)
│  │  └─ snapshot.ts        # WAL-safe snapshots, mirror dir, optional B2 upload
│  └─ aws-sdk-fallback.d.ts # ambient types for the optional B2 client
├─ shared/
│  ├─ types.ts              # === THE contract server↔web — change first, code second ===
│  ├─ graph.ts              # normalizeGraph (legacy→DAG) + topoOrder — used by runner AND canvas
│  └─ graph.test.ts          # bun:test — pins the legacy-graph migration path
├─ web/                      # React PWA
│  └─ src/views/{Chat,Nodes,Skills,Prompts,Projects,Memory,Settings}.tsx
│       components/{Message,CodeBlock,Composer,Inspector,ContextChips,Palette}.tsx
│       lib/{api,sse,store,prefs,files}.ts
└─ data/harness.db           # single SQLite file, WAL
```

---

## 3. Request flow (single call)

```
input
  → ProjectContext (active skills/memory scope)
  → PromptBuilder: base (or replace) → personas → soul → facts → skills
                    + attachments (images for vision, text/code as docs)
  → systemMode append|replace (per call; stable prefix first, so provider
    prompt caching stays effective)
  → Provider adapter (OpenRouter) → SSE
  → Stream tokens to browser (Shiki live highlight)
  → Persist message + usage {promptTokens, completionTokens, cachedTokens,
    cachedPct, costUsd, provider, model}
```

`systemMode`:
- `append` — your instructions added after provider/model defaults.
- `replace` — your full custom instruction set replaces everything.

Personas (`prompts` rows) sit between the base/replaced system and the soul:
injected as a `# Personas` section, one `## name \n content` block per active
prompt. They are selected per chat (context chips) and per graph node
(`promptIds[]`).

**Tool loop** (server-side, `server/core/tools.ts` + `router/chat.ts`): skills declare
`tools[]`; their union arrives as `ChatRequest.tools`. Only executable tools are declared
to the provider (`web_search` needs `TAVILY_API_KEY`). Streaming deltas accumulate
tool_call fragments by index; on `tool_calls` the server executes the tool (Tavily,
errors fed back as `{error}` results), emits `tool_call | tool_result` SSE, appends the
OpenAI-format messages and loops (max 4 rounds, tool results capped at 8k chars).
Usage is summed across rounds. `exec` remains declared-only: nothing executes server-side.

---

## 4. Node graph (multi-agent DAG)

**Edges are the source of truth.** A graph is `{ nodes: AgentNode[], edges: {from,to}[] }`;
node positions are persisted per node for the canvas. No nesting: a pipeline is
just single/jury nodes wired in a chain.

| Type          | Behaviour | Status |
|---------------|-----------|--------|
| `single`      | one model + system override + optional personas, in→out | runs |
| `jury`        | N models answer in parallel; a judge scores + picks winner | runs |
| `pipeline`    | legacy storage shape (root node + children + `steps[]`) | normalized on read — not creatable in the editor |
| `blended`     | merge N models into one persona (weights + optional re-synth) | planned — type declared, runner branch missing |
| `orchestrator`| coordinates nodes, runtime routing | planned — type declared, runner branch missing |

**Normalization** (`shared/graph.ts:normalizeGraph`): legacy nested pipelines are
flattened to chain edges (auto positions `x = i*320`) **on read only** — legacy
DB rows are never rewritten; a jury root or an unsaved draft passes through
untouched. Already-DAG-shaped graphs are returned as-is (by reference).

**Ordering**: `topoOrder` (Kahn) — throws on cycles with the stuck node names in
the message. Stale edges (endpoint missing) are ignored instead of crashing.

**Runner** (`graphRunner.ts`): normalize → topo order → each node's input is
the upstream outputs joined with `---` separators (or the user input for source
nodes). Sinks = nodes with no outgoing edge; multiple sinks produce numbered
`--- Output N ---` sections. `runNode` dispatches `single|jury` and **throws**
loudly on anything else. A `single` node resolves its `promptIds[]` against the
`prompts` table — a missing prompt id is a hard error naming node and id.

Jury: `panel[]` (model ids) + `judge` + `criteria[]` → `{ scores[{model,score,notes}], winner, rationale }`.
Panel members run in parallel and each emits `node_start`/`node_done` with the
model id as nodeId; the judge parses strict JSON (`winner` = one of the
candidate ids); `winnerOnly` returns just the winner's text, otherwise a
`## Winner` + verdict markdown block.

**Canvas** (`Nodes.tsx`, React Flow v12): drag-place `single`/`jury` nodes, wire
handles; a connection that would create a cycle is rejected at connect time with
the same `topoOrder` check the runner uses. Live run: nodes glow on
`node_start`/`node_done` SSE. Templates: blank / chain (A→B→C) / jury /
jury+refine. Unsaved-changes guard, per-node inspector (model, mode, system,
personas; jury: panel, judge, criteria, winner-only).

---

## 5. Skills (instructions + declared tools)

`{ id, name, description, instructions, tools: ToolName[], files{soul, facts[]}, scope }`
`instructions` injected into the prompt when toggled per chat. `tools[]` is bound at
runtime: the union of active skills' tools is sent as `ChatRequest.tools` (see §3 tool
loop). CRUD as JSON.
Scope: `global` or `project:<id>`.

---

## 6. Prompts (personas)

`{ id, name, description?, content }` — reusable system-prompt cards, stored in
the `prompts` table (same row shape, same CRUD, syncable like every other table).
Selected per chat via context chips or the Ctrl/Cmd+K palette (`activePromptIds`
persisted in localStorage) and per graph node (`promptIds[]`, resolved at run
time). Injected between the base/replaced system and the soul as `# Personas`.

---

## 7. Memory

```
memory_files (SQLite)
├─ soul    # identity, stable cacheable prompt prefix
└─ fact    # long-term context, selectively injected
```
- Long-term: soul + facts (injected via prompt builder).
- [planned] Short-term: rolling summary — today the full history is sent
  (roadmap: configurable context window, last N messages).

---

## 8. Storage + sync

```
Zustand/localStorage (browser prefs) ⇄ SQLite (backend) → snapshots → mirror dir → B2 (optional)
                                        ⇅ multi-node delta sync (pull/push, last-write-wins)
```
SQLite tables: `projects, skills, prompts, memory_files, conversations, graphs, graph_runs`
(+ `sync_log` for audit, `meta` for prefs). Every row: `id + json + updatedAt + nodeOrigin`
(document store on SQLite). Last-write-wins per row; each machine has a unique
`NODE_ID` and runs standalone.
[planned] Delete propagation (tombstones).

---

## 9. API surface (as-built)

```
GET  /api/health
POST /api/chat         { model, messages, systemMode, system, stream, ...context }  -> SSE
POST /api/graph/run    { graphId, input }                               -> SSE
GET  /api/models
CRUD /api/{skills|prompts|memory|projects|conversations|graphs|runs}   (list, get, create, update, delete)
GET|PUT /api/prefs
GET  /api/sync/pull?since=        POST /api/sync/push {since}
POST /api/sync/pull-from-peer     POST /api/sync/snapshot     GET /api/sync/snapshots
```
SSE events emitted today: `token | tool_call | tool_result | node_start | node_done | usage | done | error`.
`exec` stays declared-only (client-side execution is the rule; a container runtime is
on the roadmap).
(v1.0's `POST /api/exec` was dropped — code execution is client-side only.)

---

## 10. Frontend views (as-built)

Chat (Shiki live highlight, run button on code blocks, attachments, context
chips bar with list-style picker, cost/cached% Inspector) · Nodes (React Flow
DAG canvas + per-node inspector + templates + live-run glow + past runs) ·
Skills (CRUD, toggled per chat) · Prompts (persona cards CRUD, toggled per
chat) · Projects (model + soul + facts + skills in one click) · Memory
(soul/facts markdown editor) · Settings (snapshots, sync peers, token,
export/import). Global: Ctrl/Cmd+K palette (jump to views, conversations,
graphs; toggle personas), conversation rename/delete in the sidebar.

---

## 11. Milestones & status

1. **M1** Relay + SSE stream (OpenRouter), chat live render, keys server-side — **done**
2. **M2** Code UX: Shiki streaming highlight + run (iframe JS / Pyodide Py) — **done**
   (backend container runtime → roadmap)
3. **M3** Prompt builder + soul/facts memory + system override `append|replace` — **done**
4. **M4** Skills: CRUD + instruction injection — **done** (`web_search` tool → roadmap)
5. **M5** Node graph: granular DAG editor (React Flow) + DAG runner — **done**
   for `single|jury`; legacy pipelines normalized on read (pinned by tests);
   blended/orchestrator → roadmap
6. **M6** Storage + sync: SQLite, WAL snapshots, mirror dir, B2, pull/push — **partial**
   (tombstones → roadmap)
7. **M7** Extra providers: Anthropic / OpenAI / Gemini / custom baseURL — **planned**
8. **M8** UX granularity: prompts/personas, Ctrl/Cmd+K palette, context chips,
   conversation rename/delete, graph templates — **done**
9. **M9** Tool loop: `web_search` (Tavily) executed server-side, `tool_call`/`tool_result`
   SSE, live rendering in chat, usage summed across rounds — **done**
   (`exec` → container runtime roadmap; Google search API alternative → roadmap)
10. **M10** Thinking + context window: reasoning deltas (`delta.reasoning` /
    `delta.reasoning_content`) stream as SSE `reasoning` and render in a collapsible
    💭 block, persisted on the message, never resent to the provider;
    `contextWindow` (per-request, UI in Settings) keeps the last N messages and
    folds older ones into a model-generated rolling summary injected in the system
    prompt (cache keyed by dropped-message span; window start never splits an
    assistant tool_calls + tool results pair) — **done**

---

## 12. Non-negotiables

- Per-call system override (`append`/`replace`) — the differentiator vs TypingMind.
- Persist cost + cached-token metadata per message (e.g. "cached 1024, 39%").
- Stable cacheable system prefix (soul) to cut cost.
- Keys never reach the browser.
- Nodes runnable standalone AND syncable.
- One process, one port, one SQLite file.
- Legacy graph rows normalize on read, never rewritten — migration without migration.
- Future updates live in the README roadmap — keep it the single source.
