import type { ChatMessage } from "../../shared/types.ts";

export interface ContextSlice {
  dropped: ChatMessage[]; // older messages, to be folded into a rolling summary
  kept: ChatMessage[];    // recent window, sent verbatim to the provider
}

// Keep the last `keep` messages; fold everything older into the summary set.
// The kept window must start where the OpenAI wire format is valid: an assistant
// message with tool_calls requires its tool results right after, so leading
// tool/tool-calling messages are pushed back into `dropped` instead of cut.
export function sliceContext(messages: ChatMessage[], keep: number): ContextSlice {
  if (!Number.isFinite(keep) || keep <= 0 || messages.length <= keep) {
    return { dropped: [], kept: messages };
  }
  const dropped = messages.slice(0, messages.length - keep);
  const kept = messages.slice(messages.length - keep);
  while (kept.length && (kept[0].role === "tool" || (kept[0].role === "assistant" && kept[0].toolCalls?.length))) {
    dropped.push(kept.shift()!);
  }
  // Degenerate cut (window full of tool traffic): no summary is better than an empty prompt.
  if (kept.length === 0) return { dropped: [], kept: messages };
  return { dropped, kept };
}
