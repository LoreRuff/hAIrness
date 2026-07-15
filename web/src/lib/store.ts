import { schedulePrefsPush } from "./prefs";
import { create } from "zustand";
import type { ChatMessage, Conversation, Graph, MemoryFile, ModelInfo, Project, Skill, SystemMode, Usage } from "../types";

export type ViewId = "chat" | "nodes" | "skills" | "memory" | "projects" | "settings";
function lsGet<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "") as T; } catch { return fallback; }
}
function lsSet(key: string, v: unknown) {
  localStorage.setItem(key, JSON.stringify(v));
  schedulePrefsPush();
}
interface HarnessState {
  view: ViewId;
  setView: (v: ViewId) => void;

  models: ModelInfo[];
  setModels: (m: ModelInfo[]) => void;

  model: string;
  setModel: (m: string) => void;
  systemMode: SystemMode;
  setSystemMode: (m: SystemMode) => void;
  system: string;
  setSystem: (s: string) => void;
  temperature: number;
  setTemperature: (t: number) => void;

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
  usages: Record<string, Usage>;
  setUsage: (msgId: string, u: Usage) => void;

  streaming: boolean;
  setStreaming: (s: boolean) => void;

  skills: Skill[];
  setSkills: (s: Skill[]) => void;
  activeSkillIds: string[];
  toggleSkill: (id: string) => void;

  memoryFiles: MemoryFile[];
  setMemoryFiles: (m: MemoryFile[]) => void;
  activeSoulId: string | null;
  setActiveSoul: (id: string | null) => void;
  activeFactIds: string[];
  toggleFact: (id: string) => void;

  projects: Project[];
  setProjects: (p: Project[]) => void;
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;

  graphs: Graph[];
  setGraphs: (g: Graph[]) => void;

}

export const useStore = create<HarnessState>((set) => ({
  view: "chat",
  setView: (view) => set({ view }),

  models: [],
  setModels: (models) => set({ models }),

  model: localStorage.getItem("harness_model") || "openai/gpt-4o-mini",
  setModel: (model) => { localStorage.setItem("harness_model", model); schedulePrefsPush(); set({ model }); },
  systemMode: lsGet<SystemMode>("harness_mode", "append"),
  setSystemMode: (systemMode) => { lsSet("harness_mode", systemMode); set({ systemMode }); },
  system: localStorage.getItem("harness_system") ?? "",
   setSystem: (system) => {localStorage.setItem("harness_system", system); schedulePrefsPush(); set({ system }); },
  temperature: lsGet<number>("harness_temp", 0.7),
  setTemperature: (temperature) => { lsSet("harness_temp", temperature); set({ temperature }); },

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
  appendToLast: (text) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last) msgs[msgs.length - 1] = { ...last, content: last.content + text };
      return { messages: msgs };
    }),
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

  memoryFiles: [],
  setMemoryFiles: (memoryFiles) => set({ memoryFiles }),
  activeSoulId: lsGet<string | null>("harness_soul", null),
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

  projects: [],
  setProjects: (projects) => set({ projects }),
  currentProjectId: lsGet<string | null>("harness_project", null),
  setCurrentProjectId: (id) => { lsSet("harness_project", id); set({ currentProjectId: id }); },
  
  graphs: [],
  setGraphs: (graphs) => set({ graphs }),
}));
