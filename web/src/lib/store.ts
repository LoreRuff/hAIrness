import { schedulePrefsPush } from "./prefs";
import { create } from "zustand";
import { nanoid } from "nanoid";
import type { AuthRole, ChatMessage, Conversation, Graph, Harness, MemoryFile, ModelInfo, Project, PromptFile, Skill, SystemMode, ToolCall, Usage } from "../types";

export type ViewId = "chat" | "nodes" | "library" | "settings" | "users";
function lsGet<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}
function lsSet(key: string, v: unknown) {
  localStorage.setItem(key, JSON.stringify(v));
  schedulePrefsPush();
}
interface HarnessState {
  view: ViewId;
  viewStack: ViewId[];
  setView: (v: ViewId) => void;
  back: () => void;

  models: ModelInfo[];
  setModels: (m: ModelInfo[]) => void;
  harnesses: Harness[];
  setHarnesses: (h: Harness[]) => void;
  harnessId: string | null;   // active harness; null = ad-hoc state below
  setHarnessId: (id: string | null) => void;

  model: string;
  setModel: (m: string) => void;
  systemMode: SystemMode;
  setSystemMode: (m: SystemMode) => void;
  system: string;
  setSystem: (s: string) => void;
  temperature: number;
  setTemperature: (t: number) => void;
  reasoning: string;          // effort hint for reasoning models: "" = auto, or low/medium/high
  setReasoning: (r: string) => void;
  contextWindow: number;      // last N messages sent to the model; 0 = full history
  setContextWindow: (n: number) => void;
  summaryPrompt: string;      // user prompt for the rolling-summary generator; "" = server default
  setSummaryPrompt: (p: string) => void;

  enterToSend: boolean;
  toggleEnterToSend: () => void;

  showSidebar: boolean;
  showInspector: boolean;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  closePanels: () => void;

  conversations: Conversation[];
  setConversations: (c: Conversation[]) => void;
  currentId: string | null;
  setCurrentId: (id: string | null) => void;

  messages: ChatMessage[];
  setMessages: (m: ChatMessage[]) => void;
  appendToLast: (text: string) => void;
  appendToLastReasoning: (text: string) => void;
  attachToolCall: (call: ToolCall) => void;
  appendToolResult: (callId: string, result: unknown) => void;
  usages: Record<string, Usage>;
  setUsage: (msgId: string, u: Usage) => void;

  streaming: boolean;
  setStreaming: (s: boolean) => void;

  skills: Skill[];
  setSkills: (s: Skill[]) => void;
  activeSkillIds: string[];
  toggleSkill: (id: string) => void;
  setActiveSkillIds: (ids: string[]) => void;

  prompts: PromptFile[];
  setPrompts: (p: PromptFile[]) => void;
  activePromptIds: string[];
  togglePrompt: (id: string) => void;
  setActivePromptIds: (ids: string[]) => void;

  memoryFiles: MemoryFile[];
  setMemoryFiles: (m: MemoryFile[]) => void;
  activeSoulId: string | null;
  setActiveSoul: (id: string | null) => void;
  activeFactIds: string[];
  toggleFact: (id: string) => void;
  setActiveFactIds: (ids: string[]) => void;

  projects: Project[];
  setProjects: (p: Project[]) => void;
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;

  graphs: Graph[];
  setGraphs: (g: Graph[]) => void;
  focusGraphId: string | null;
  setFocusGraphId: (id: string | null) => void;

  toast: string | null;        // transient in-app notification strip
  setToast: (t: string | null) => void;

  // Auth role of the logged-in session (null until /api/auth/session lands).
  // Gates owner-only surfaces like the Users panel; never persisted to
  // localStorage: it must always come from the live session.
  role: AuthRole | null;
  setRole: (r: AuthRole | null) => void;

}

export const useStore = create<HarnessState>((set) => ({
  view: "chat",
  // N4 anti-sinkhole: navigation stack for the ← back button (rail switches
  // push too; back() pops without pushing; capped so a session can't balloon).
  viewStack: [] as ViewId[],
  setView: (view) => set((s) => ({ view, viewStack: [...s.viewStack.slice(-19), s.view] })),
  back: () => set((s) => {
    if (s.viewStack.length === 0) return {};
    const stack = [...s.viewStack];
    const view = stack.pop()!;
    return { view, viewStack: stack };
  }),

  models: [],
  setModels: (models) => set({ models }),
  harnesses: [],
  setHarnesses: (harnesses) => set({ harnesses }),
  harnessId: lsGet<string | null>("harness_harness_id", null),
  setHarnessId: (harnessId) => { lsSet("harness_harness_id", harnessId); set({ harnessId }); },

  model: localStorage.getItem("harness_model") || "openai/gpt-4o-mini",
  setModel: (model) => { localStorage.setItem("harness_model", model); schedulePrefsPush(); set({ model }); },
  systemMode: lsGet<SystemMode>("harness_mode", "append"),
  setSystemMode: (systemMode) => { lsSet("harness_mode", systemMode); set({ systemMode }); },
  system: localStorage.getItem("harness_system") ?? "",
   setSystem: (system) => {localStorage.setItem("harness_system", system); schedulePrefsPush(); set({ system }); },
  temperature: lsGet<number>("harness_temp", 0.7),
  setTemperature: (temperature) => { lsSet("harness_temp", temperature); set({ temperature }); },
  reasoning: lsGet<string>("harness_reasoning", ""),
  setReasoning: (reasoning) => { lsSet("harness_reasoning", reasoning); set({ reasoning }); },
  contextWindow: lsGet<number>("harness_ctx_window", 0),
  setContextWindow: (contextWindow) => { lsSet("harness_ctx_window", contextWindow); set({ contextWindow }); },
  summaryPrompt: lsGet<string>("harness_summary_prompt", ""),
  setSummaryPrompt: (summaryPrompt) => { lsSet("harness_summary_prompt", summaryPrompt); set({ summaryPrompt }); },

  enterToSend: lsGet<boolean>("harness_enter_send", true),
  toggleEnterToSend: () =>
    set((s) => { lsSet("harness_enter_send", !s.enterToSend); return { enterToSend: !s.enterToSend }; }),

  showSidebar: false,
  showInspector: false,
  toggleSidebar: () => set((s) => ({ showSidebar: !s.showSidebar, showInspector: false })),
  toggleInspector: () => set((s) => ({ showInspector: !s.showInspector, showSidebar: false })),
  closePanels: () => set({ showSidebar: false, showInspector: false }),

  conversations: [],
  setConversations: (conversations) => set({ conversations }),
  currentId: null,
  setCurrentId: (currentId) => set({ currentId }),

  messages: [],
  setMessages: (messages) => set({ messages }),
  // Tokens always target the last assistant bubble: tool results interleave
  // as role:"tool" messages but must never capture the token stream.
  appendToLast: (text) =>
    set((s) => {
      const msgs = [...s.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], content: msgs[i].content + text };
          return { messages: msgs };
        }
      }
      return {};
    }),
  // Reasoning targets the last assistant bubble too, same rule as tokens.
  appendToLastReasoning: (text) =>
    set((s) => {
      const msgs = [...s.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = { ...msgs[i], reasoning: (msgs[i].reasoning ?? "") + text };
          return { messages: msgs };
        }
      }
      return {};
    }),
  attachToolCall: (call) =>
    set((s) => {
      const msgs = [...s.messages];
      let i = -1;
      for (let k = msgs.length - 1; k >= 0; k--) {
        if (msgs[k].role === "assistant") { i = k; break; }
      }
      if (i < 0) return {};
      msgs[i] = { ...msgs[i], toolCalls: [...(msgs[i].toolCalls ?? []), call] };
      return { messages: msgs };
    }),
  appendToolResult: (callId, result) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: nanoid(10),
          role: "tool" as const,
          toolCallId: callId,
          content: JSON.stringify(result),
          createdAt: Date.now(),
        },
      ],
    })),
  usages: {},
  setUsage: (msgId, u) => set((s) => ({ usages: { ...s.usages, [msgId]: u } })),

  streaming: false,
  setStreaming: (streaming) => set({ streaming }),

  skills: [],
  setSkills: (skills) => set({ skills }),
  activeSkillIds: lsGet<string[]>("harness_active_skills", []),
  toggleSkill: (id) =>
    set((s) => {
      const next = s.activeSkillIds.includes(id)
        ? s.activeSkillIds.filter((x) => x !== id)
        : [...s.activeSkillIds, id];
      lsSet("harness_active_skills", next);
      return { activeSkillIds: next };
    }),
  setActiveSkillIds: (activeSkillIds) => { lsSet("harness_active_skills", activeSkillIds); set({ activeSkillIds }); },

  prompts: [],
  setPrompts: (prompts) => set({ prompts }),
  activePromptIds: lsGet<string[]>("harness_prompts", []),
  togglePrompt: (id) =>
    set((s) => {
      const next = s.activePromptIds.includes(id)
        ? s.activePromptIds.filter((x) => x !== id)
        : [...s.activePromptIds, id];
      lsSet("harness_prompts", next);
      return { activePromptIds: next };
    }),
  setActivePromptIds: (activePromptIds) => { lsSet("harness_prompts", activePromptIds); set({ activePromptIds }); },

  memoryFiles: [],
  setMemoryFiles: (memoryFiles) => set({ memoryFiles }),  activeSoulId: lsGet<string | null>("harness_soul", null),
  setActiveSoul: (id) => { lsSet("harness_soul", id); set({ activeSoulId: id }); },
  activeFactIds: lsGet<string[]>("harness_facts", []),
  toggleFact: (id) =>
    set((s) => {
      const next = s.activeFactIds.includes(id)
        ? s.activeFactIds.filter((x) => x !== id)
        : [...s.activeFactIds, id];
      lsSet("harness_facts", next);
      return { activeFactIds: next };
    }),

  setActiveFactIds: (activeFactIds) => { lsSet("harness_facts", activeFactIds); set({ activeFactIds }); },

  projects: [],
  setProjects: (projects) => set({ projects }),
  currentProjectId: lsGet<string | null>("harness_project", null),
  setCurrentProjectId: (id) => { lsSet("harness_project", id); set({ currentProjectId: id }); },
  
  graphs: [],
  setGraphs: (graphs) => set({ graphs }),
  focusGraphId: null,
  setFocusGraphId: (focusGraphId) => set({ focusGraphId }),

  toast: null,
  setToast: (toast) => set({ toast }),

  role: null,
  setRole: (role) => set({ role }),
}));

// Reasoning effort options for the currently selected model, straight from
// the catalog refresh (/api/models): per-model supported_efforts. Fallback
// covers models that omit the field; "auto" (empty value) is always offered.
export function effortsFor(models: ModelInfo[], model: string): string[] {
  const e = models.find((m) => m.id === model)?.reasoningEfforts;
  return e && e.length ? e : ["low", "medium", "high"];
}

// A harness is the saved shape of the ad-hoc context. Applying it copies its
// fields into the live state (persisted through the same setters), so chat
// keeps consuming the ad-hoc fields while the harness remains the source of
// truth the Inspector writes back to.
export function applyHarness(h: Harness) {
  const s = useStore.getState();
  s.setModel(h.model);
  s.setSystemMode(h.systemMode);
  s.setSystem(h.system ?? "");
  s.setTemperature(h.temperature ?? 0.7);
  s.setReasoning(h.reasoning ?? "");
  s.setContextWindow(h.contextWindow ?? 0);
  s.setActivePromptIds(h.promptIds ?? []);
  s.setActiveSkillIds(h.skills);
  s.setActiveSoul(h.memory.soul);
  s.setActiveFactIds(h.memory.facts);
}
