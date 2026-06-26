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
}

/* ---------- Messages & Chat ---------- */
export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;        // for role:"tool"
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
  stream: boolean;
  projectId?: string;
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
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; callId: string; result: unknown }
  | { type: "node_start"; nodeId: string }
  | { type: "node_done"; nodeId: string; output: string }
  | { type: "usage"; usage: Usage }
  | { type: "done" }
  | { type: "error"; message: string };

/* ---------- Tools ---------- */
export type ToolName = "web_search" | "exec";

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
  kind: "soul" | "fact";
  name: string;               // e.g. "soul.md", "enkk.md"
  content: string;            // markdown
  updatedAt: number;
  nodeOrigin: string;
}

export interface MemoryRef {
  soul: string | null;        // memory file id
  facts: string[];            // memory file ids
}

/* ---------- Nodes (multi-agent graph) ---------- */
export type NodeType =
  | "single"
  | "pipeline"
  | "jury"
  | "blended"
  | "orchestrator";

export interface BaseNode {
  id: string;
  type: NodeType;
  name: string;
  systemMode: SystemMode;
  system?: string;
  skills: string[];           // skill ids
  memory: MemoryRef;
  tools: ToolName[];
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

export type AgentNode =
  | SingleNode
  | PipelineNode
  | JuryNode
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

/* ---------- Sync ---------- */
export type Syncable =
  | { table: "projects"; row: Project }
  | { table: "skills"; row: Skill }
  | { table: "memory_files"; row: MemoryFile }
  | { table: "graphs"; row: Graph }
  | { table: "conversations"; row: Conversation };

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
