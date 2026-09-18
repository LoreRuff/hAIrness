// ============================================================
// AI HARNESS — shared contract (server + web)
// ============================================================

/* ---------- Providers & Models ---------- */
export type ProviderId =
  | "openrouter"
  | "anthropic"
  | "openai"
  | "gemini"
  | "custom";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  baseUrl: string;            // OpenAI-compatible endpoint
  apiKeyEnv: string;          // env var name; key NEVER sent to browser
  enabled: boolean;
}

export interface ModelInfo {
  id: string;                 // e.g. "openai/gpt-4o"
  provider: ProviderId;
  label: string;
  contextWindow?: number;
  inputPrice?: number;        // per 1M tokens
  outputPrice?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  // Reasoning efforts this model accepts, from the OR catalog
  // (reasoning.supported_efforts, e.g. ["xhigh","high","medium","low"]). Empty = non-reasoning.
  reasoningEfforts?: string[];
}

/* ---------- Messages & Chat ---------- */
export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  reasoning?: string;         // model thinking/CoT (display only, never resent)
  toolCalls?: ToolCall[];
  toolCallId?: string;        // for role:"tool"
  attachments?: Attachment[]; // images for vision models + text/code docs
  createdAt: number;
}

export type SystemMode = "append" | "replace";

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  systemMode: SystemMode;     // KEY FEATURE
  system?: string;            // custom instructions
  tools?: ToolName[];
  temperature?: number;
  reasoning?: string;         // effort hint for reasoning models: low | medium | high
  stream: boolean;
  projectId?: string;
  contextWindow?: number;     // keep last N messages, older ones → rolling summary; 0 = full history
  summaryPrompt?: string;     // user prompt for the rolling-summary generator; empty = built-in default
  regenSummary?: boolean;     // bypass the summary cache and re-summarize the dropped span
}

/* ---------- Usage / cost metadata (enkk-style) ---------- */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cachedPct: number;          // 0..100
  costUsd: number;
  provider: ProviderId;
  model: string;
}

/* ---------- SSE events ---------- */
export type SSEEvent =
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; callId: string; result: unknown }
  | { type: "node_start"; nodeId: string }
  | { type: "node_done"; nodeId: string; output: string }
  | { type: "usage"; usage: Usage }
  // Human-in-the-loop: the run is parked server-side (graph_run_state) and
  // the stream closes; the answer travels back via POST /api/graph/resume.
  | { type: "human_input_required"; runId: string; nodeId: string; prompt: string; varName: string }
  | { type: "done" }
  | { type: "error"; message: string };

/* ---------- Tools ---------- */
export type ToolName = string; // dynamic: builtin + mcp_<server>_<tool> from config/tools.json

export interface ToolCall {
  id: string;
  name: ToolName;
  args: Record<string, unknown>;
}

export interface WebSearchArgs { query: string; maxResults?: number }
export interface ExecArgs { lang: "javascript" | "python" | "bash"; code: string }
export interface ExecResult { ok: boolean; stdout: string; stderr: string; durationMs: number }

/* ---------- Skills ---------- */
export type Scope = "global" | `project:${string}`;

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;       // injected into prompt
  tools: ToolName[];          // bound at runtime
  files: { soul: string | null; facts: string[] };
  scope: Scope;
  updatedAt: number;
  nodeOrigin: string;         // sync provenance
}

/* ---------- Memory ---------- */
export interface MemoryFile {
  id: string;
  kind: "soul" | "fact" | "auto"; // "auto" = derived from idle chat analysis (N3)
  name: string;               // e.g. "soul.md", "enkk.md"
  content: string;            // markdown
  updatedAt: number;
  nodeOrigin: string;
}

export interface MemoryRef {
  soul: string | null;        // memory file id
  facts: string[];            // memory file ids
}

/* ---------- Prompts (reusable system personas) ---------- */
// Same lifecycle as skills/memory (CRUD + sync + LWW) so reusable system
// prompts become selectable entities instead of one global textarea.
export interface PromptFile {
  id: string;
  name: string;
  description?: string;
  content: string;             // injected into the system prompt
  updatedAt: number;
  nodeOrigin: string;
}

/* ---------- Nodes (multi-agent graph) ---------- */
export type NodeType =
  | "single"
  | "pipeline"
  | "jury"
  | "curator"
  | "tool"
  | "human"
  | "blended"
  | "orchestrator";

export interface BaseNode {
  id: string;
  type: NodeType;
  name: string;
  systemMode: SystemMode;
  system?: string;
  // Variable template for the node input ({{var.x}} / {{node.output}}).
  // Absent = legacy behavior: join upstream outputs (or the user input).
  inputTemplate?: string;
  promptIds?: string[];       // reusable persona prompts (like skills, per-node)
  skills: string[];           // skill ids
  memory: MemoryRef;
  tools: ToolName[];
  // Per-node run overrides (N5): unset = graph-run defaults (temp 0.7).
  temperature?: number;
  reasoning?: string;         // effort hint for reasoning models
  inputs: string[];           // upstream node ids
  outputs: string[];          // downstream node ids
  nodes?: AgentNode[];        // nested sub-nodes
  position?: { x: number; y: number };
}

export interface SingleNode extends BaseNode {
  type: "single";
  model: string;
}

export interface PipelineNode extends BaseNode {
  type: "pipeline";
  steps: string[];            // ordered child node ids
}

export interface JuryNode extends BaseNode {
  type: "jury";
  panel: string[];            // model ids answering in parallel
  judge: string;              // judge model id
  criteria: string[];
  winnerOnly?: boolean;       // clean output — meant when chained into a pipeline
}

export interface BlendItem { model: string; weight: number }
export interface BlendedNode extends BaseNode {
  type: "blended";
  mix: BlendItem[];           // "mangiacose" persona
  resynthModel?: string;      // optional final re-synth pass
}

export interface OrchestratorNode extends BaseNode {
  type: "orchestrator";
  routerModel: string;        // decides routing at runtime
  managed: string[];          // node ids it can dispatch to
}

// v1 node types (P3). Curator: selects the best parts of upstream output
// and passes them on. Tool: server-side executor, zero LLM. Human: the run
// pauses until the user supplies the answer (resume endpoint).
export interface CuratorNode extends BaseNode {
  type: "curator";
  model: string;
  criteria: string[];         // what makes a fragment worth passing on
  mode: "filter" | "pass";    // filter: echo selected parts only; pass: rewrite/collate them
}

export interface ToolNode extends BaseNode {
  type: "tool";
  tool: "web_search";         // v1: the only server-side executor
  args: Record<string, string>; // values are templates ({{var.*}})
}

export interface HumanNode extends BaseNode {
  type: "human";
  prompt: string;             // question shown to the user (template)
  varName: string;            // answer lands in run vars as var.<varName>
}

export type AgentNode =
  | SingleNode
  | PipelineNode
  | JuryNode
  | CuratorNode
  | ToolNode
  | HumanNode
  | BlendedNode
  | OrchestratorNode;

export interface Graph {
  id: string;
  name: string;
  projectId?: string;
  nodes: AgentNode[];
  edges: { from: string; to: string }[];
  updatedAt: number;
  nodeOrigin: string;
}

export interface JuryResult {
  scores: { model: string; score: number; notes: string }[];
  winner: string;
  rationale: string;
}

/* ---------- Projects ---------- */
export interface Project {
  id: string;
  name: string;
  description?: string;
  activeSkills: string[];     // skill ids in scope
  activeMemory: MemoryRef;
  defaultModel?: string;
  updatedAt: number;
  nodeOrigin: string;
}

/* ---------- Benchmark cases (P3: run playground = task benchmark) ---------- */
// A case is just (graph, input) seeded from a past run; lastRun carries the
// most recent benchmark execution so improvements regress-visibly.
export interface BenchmarkResult {
  at: number;
  durationMs: number;
  output?: string;
  error?: string;
}

export interface BenchmarkCase {
  id: string;
  graphId: string;
  name: string;
  input: string;
  lastRun?: BenchmarkResult;
  updatedAt: number;
  nodeOrigin: string;
}

/* ---------- Conversations ---------- */
export interface Conversation {
  id: string;
  projectId?: string;
  title: string;
  messages: ChatMessage[];
  usageTotal: Usage[];
  updatedAt: number;
  nodeOrigin: string;
}

/* ---------- Harness (P2: first-class config object) ---------- */
// One persistent id, immutable snapshots (git-style): each save/restore writes
// a content-addressed version; the head row carries rev (bumped on restore).
export interface Harness {
  id: string;
  name: string;
  rev: number;                // bumped on restore so peers LWW-propagate the head
  model: string;
  systemMode: SystemMode;
  system?: string;
  promptIds?: string[];       // reusable personas, by reference
  skills: string[];           // skill ids, by reference (never copied)
  memory: MemoryRef;          // soul + facts, by reference
  tools: ToolName[];
  reasoning?: string;         // profile slug from the reasoning registry (P2)
  temperature?: number;
  contextWindow?: number;     // last N messages sent to the model; 0 = full history, 1 = current only
  updatedAt: number;
  nodeOrigin: string;
}

export interface HarnessVersionMeta {
  versionId: string;
  harnessId: string;
  rev: number;
  at: number;
}

export interface HarnessExport {
  schemaVersion: 1;           // harness.json contract (decision #11)
  exportedAt: number;
  harness: Harness;
  refs: {                     // autocontenuto: references resolved inline
    skills: Skill[];
    prompts: PromptFile[];
    soul: MemoryFile | null;
    facts: MemoryFile[];
  };
}

/* ---------- Sync ---------- */
export type Syncable =
  | { table: "projects"; row: Project }
  | { table: "skills"; row: Skill }
  | { table: "memory_files"; row: MemoryFile }
  | { table: "prompts"; row: PromptFile }
  | { table: "graphs"; row: Graph }
  | { table: "conversations"; row: Conversation }
  | { table: "harnesses"; row: Harness };

export interface SyncDelta {
  since: number;              // unix ms
  nodeId: string;
  rows: Syncable[];
}

export interface SyncLogEntry {
  id: string;
  table: string;
  rowId: string;
  action: "create" | "update" | "delete";
  nodeOrigin: string;
  at: number;
  conflict?: boolean;
}

/* ---------- Settings ---------- */
export interface Settings {
  nodeId: string;             // unique per machine (VPS/desktop/laptop)
  peers: string[];            // peer node URLs
  providers: ProviderConfig[];
  backblaze: {
    enabled: boolean;
    bucket: string;
    intervalMin: number;      // snapshot schedule
  };
  defaultModel: string;
  uiDensity: "compact" | "comfortable";
}

/* ---------- API responses ---------- */
export interface ApiList<T> { items: T[] }
export interface ApiError { error: string }
/* ---------- Attachments (composer) ---------- */
export interface Attachment {
  id: string;
  kind: "image" | "text";
  name: string;
  mime: string;
  dataUrl?: string;   // images: base64 data URL (multimodal payload)
  text?: string;      // documents: extracted text (injected into prompt)
}
