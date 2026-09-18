import type { SSEEvent } from "../types";
import { getToken } from "./api";

export async function streamEvents(
  path: string,
  payload: unknown,
  onEvent: (ev: SSEEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const t = getToken();
  if (t) headers["Authorization"] = `Bearer ${t}`;

  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(payload), signal });
  if (!res.ok || !res.body) {
    // Quota (429) and rate-limit rejections answer with JSON before any SSE
    // frame; surface the human error through the same error channel so Chat
    // prints it like any other failure.
    let message = `HTTP ${res.status}`;
    // A JSON error body still arrives as a ReadableStream, so !res.ok alone
    // is the right trigger for the parse (checking !res.body never fires).
    const b = await res.json().catch(() => null) as { error?: string; resetAt?: number } | null;
    if (b?.error) message = b.resetAt ? `${b.error} · resets at ${new Date(b.resetAt).toLocaleString()}` : b.error;
    onEvent({ type: "error", message });
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t2 = line.trim();
      if (!t2.startsWith("data:")) continue;
      const raw = t2.slice(5).trim();
      if (!raw) continue;
      try { onEvent(JSON.parse(raw) as SSEEvent); } catch { /* ignore */ }
    }
  }
}

export const streamChat = (payload: unknown, on: (ev: SSEEvent) => void, signal?: AbortSignal) =>
  streamEvents("/api/chat", payload, on, signal);
