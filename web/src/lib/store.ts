import { create } from "zustand";
import type { ChatMessage, Conversation, ModelInfo, SystemMode, Usage } from "../types";

export type ViewId = "chat" | "skills" | "memory" | "projects" | "settings";

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
}

export const useStore = create<HarnessState>((set) => ({
  view: "chat",
  setView: (view) => set({ view }),

  models: [],
  setModels: (models) => set({ models }),

  model: localStorage.getItem("harness_model") || "openai/gpt-4o-mini",
  setModel: (model) => { localStorage.setItem("harness_model", model); set({ model }); },
  systemMode: "append",
  setSystemMode: (systemMode) => set({ systemMode }),
  system: "",
  setSystem: (system) => set({ system }),
  temperature: 0.7,
  setTemperature: (temperature) => set({ temperature }),

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
}));
