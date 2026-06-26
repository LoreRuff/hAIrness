import type { ChatMessage, SystemMode } from "../../shared/types.ts";

const BASE_SYSTEM = `You are AI Harness, a precise, terse engineering assistant.
Prefer runnable code in fenced blocks with a language tag. No filler.`;

export interface BuildArgs {
  systemMode: SystemMode;
  system?: string;
  soul?: string | null;
  facts?: string[];
  skillInstructions?: string[];
  messages: ChatMessage[];
}

export function buildMessages(a: BuildArgs) {
  const parts: string[] = [];
  if (a.systemMode === "replace") {
    if (a.system?.trim()) parts.push(a.system.trim());
  } else {
    parts.push(BASE_SYSTEM);
    if (a.system?.trim()) parts.push(a.system.trim());
  }
  if (a.soul?.trim()) parts.push(`# Identity (soul.md)\n${a.soul.trim()}`);
  if (a.facts?.length) parts.push(`# Known facts\n${a.facts.join("\n\n")}`);
  if (a.skillInstructions?.length) parts.push(`# Active skills\n${a.skillInstructions.join("\n\n")}`);

  const systemContent = parts.join("\n\n---\n\n");
  const out: { role: string; content: string }[] = [];
  if (systemContent.trim()) out.push({ role: "system", content: systemContent });
  for (const m of a.messages) {
    if (m.role === "system") continue;
    out.push({ role: m.role, content: m.content });
  }
  return out;
}
