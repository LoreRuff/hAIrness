import type { Attachment, ChatMessage, SystemMode } from "../../shared/types.ts";

const BASE_SYSTEM = `You are AI Harness, a precise, terse engineering assistant.
Prefer runnable code in fenced blocks with a language tag. No filler.`;

type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type OutMessage = {
  role: string;
  content: string | Part[] | null;
  tool_calls?: unknown[];  // assistant messages that requested tools
  tool_call_id?: string;   // role:"tool" messages
};

export interface BuildArgs {
  systemMode: SystemMode;
  system?: string;
  promptInstructions?: string[]; // reusable personas, one entry per prompt
  soul?: string | null;
  facts?: string[];
  skillInstructions?: string[];
  messages: ChatMessage[];
}

function renderMessage(m: ChatMessage): OutMessage {
  // m.reasoning is deliberately NOT resent: it is display-only CoT, resending
  // it would drift history from what the provider actually emitted.
  // Tool-loop history: the provider needs the raw assistant tool_calls and the
  // tool results back in OpenAI wire format to continue multi-turn tool use.
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
  }
  const atts: Attachment[] = m.attachments ?? [];
  const docs = atts.filter((a) => a.kind === "text" && a.text);
  const images = atts.filter((a) => a.kind === "image" && a.dataUrl);

  let text = m.content;
  for (const d of docs) {
    text += `\n\n--- Attached file: ${d.name} ---\n${d.text}`;
  }
  if (m.toolCalls?.length) {
    return {
      role: "assistant",
      content: text || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    };
  }
  if (images.length === 0) return { role: m.role, content: text };

  const parts: Part[] = [{ type: "text", text }];
  for (const img of images) parts.push({ type: "image_url", image_url: { url: img.dataUrl! } });
  return { role: m.role, content: parts };
}

export function buildMessages(a: BuildArgs): OutMessage[] {
  const parts: string[] = [];
  if (a.systemMode === "replace") {
    if (a.system?.trim()) parts.push(a.system.trim());
  } else {
    parts.push(BASE_SYSTEM);
    if (a.system?.trim()) parts.push(a.system.trim());
  }
  // Personas sit between the base/system layer and the personal layers
  // (soul/facts/skills): they shape HOW the assistant behaves, identity comes after.
  if (a.promptInstructions?.length) parts.push(`# Personas\n${a.promptInstructions.join("\n\n")}`);
  if (a.soul?.trim()) parts.push(`# Identity (soul.md)\n${a.soul.trim()}`);
  if (a.facts?.length) parts.push(`# Known facts\n${a.facts.join("\n\n")}`);
  if (a.skillInstructions?.length) parts.push(`# Active skills\n${a.skillInstructions.join("\n\n")}`);

  const systemContent = parts.join("\n\n---\n\n");
  const out: OutMessage[] = [];
  if (systemContent.trim()) out.push({ role: "system", content: systemContent });
  for (const m of a.messages) {
    if (m.role === "system") continue;
    out.push(renderMessage(m));
  }
  return out;
}
