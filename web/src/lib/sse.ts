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
    onEvent({ type: "error", message: `HTTP ${res.status}` });
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
