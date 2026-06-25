import type { ChatMessage, SystemMode } from "../../shared/types.ts";

// Default base system prompt (the "provider/model default" we append to).
const BASE_SYSTEM = `You are AI Harness, a precise, terse engineering assistant.
Prefer runnable code. Use fenced code blocks with a language tag. No filler.`;

export interface BuildArgs {
  systemMode: SystemMode;
  system?: string;            // user custom instructions
  soul?: string | null;       // soul.md content
  facts?: string[];           // selected facts/*.md contents
  skillInstructions?: string[]; // injected skill instructions
  messages: ChatMessage[];
}

/** Builds the final message array for the provider, honoring append|replace. */
export function buildMessages(a: BuildArgs) {
  const parts: string[] = [];

  if (a.systemMode === "replace") {
    // user's instructions fully replace the base/provider defaults
    if (a.system?.trim()) parts.push(a.system.trim());
  } else {
    // append: base first (stable, cacheable prefix), then extras
    parts.push(BASE_SYSTEM);
    if (a.system?.trim()) parts.push(a.system.trim());
  }

  // soul.md = stable cacheable identity prefix (kept right after system)
  if (a.soul?.trim()) parts.push(`# Identity (soul.md)\n${a.soul.trim()}`);

  if (a.facts?.length) {
    parts.push(`# Known facts\n${a.facts.map((f) => f.trim()).join("\n\n")}`);
  }

  if (a.skillInstructions?.length) {
    parts.push(`# Active skills\n${a.skillInstructions.join("\n\n")}`);
  }

  const systemContent = parts.join("\n\n---\n\n");

  const out: { role: string; content: string }[] = [];
  if (systemContent.trim()) out.push({ role: "system", content: systemContent });

  for (const m of a.messages) {
    if (m.role === "system") continue; // system handled above
    out.push({ role: m.role, content: m.content });
  }
  return out;
}
