import { describe, expect, test } from "bun:test";
import { sliceContext } from "./context.ts";
import type { ChatMessage } from "../../shared/types.ts";

const msg = (id: string, role: ChatMessage["role"], extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role, content: `body-${id}`, createdAt: 0, ...extra,
});

describe("sliceContext", () => {
  test("disabled / small conversations pass through untouched", () => {
    const m = [msg("a", "user"), msg("b", "assistant")];
    expect(sliceContext(m, 0)).toEqual({ dropped: [], kept: m });
    expect(sliceContext(m, -5)).toEqual({ dropped: [], kept: m });
    expect(sliceContext(m, 2)).toEqual({ dropped: [], kept: m });
  });

  test("keeps the last N messages and drops the older ones", () => {
    const m = [msg("1", "user"), msg("2", "assistant"), msg("3", "user"), msg("4", "assistant")];
    const r = sliceContext(m, 2);
    expect(r.dropped.map((x) => x.id)).toEqual(["1", "2"]);
    expect(r.kept.map((x) => x.id)).toEqual(["3", "4"]);
  });

  test("a kept window cannot start with a tool result", () => {
    const m = [
      msg("1", "user"),
      msg("2", "assistant", { toolCalls: [{ id: "t1", name: "web_search", args: {} }] }),
      msg("3", "tool", { toolCallId: "t1" }),
      msg("4", "assistant"),
      msg("5", "user"),
    ];
    const r = sliceContext(m, 2);
    // tool result "3" is not a valid window start → it falls back into dropped
    expect(r.kept.map((x) => x.id)).toEqual(["4", "5"]);
    expect(r.dropped.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });

  test("a leading assistant with tool_calls is dropped too (its results are outside the window)", () => {
    const m = [
      msg("1", "user"),
      msg("2", "assistant", { toolCalls: [{ id: "t1", name: "web_search", args: {} }] }),
      msg("3", "tool", { toolCallId: "t1" }),
      msg("4", "user"),
      msg("5", "assistant"),
    ];
    const r = sliceContext(m, 2);
    expect(r.kept.map((x) => x.id)).toEqual(["4", "5"]);
    expect(r.dropped.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });

  test("degenerate window (only tool traffic) → no truncation at all", () => {
    const m = [
      msg("1", "user"),
      msg("2", "assistant", { toolCalls: [{ id: "t1", name: "web_search", args: {} }] }),
      msg("3", "tool", { toolCallId: "t1" }),
    ];
    const r = sliceContext(m, 1);
    expect(r.dropped).toEqual([]);
    expect(r.kept).toEqual(m);
  });
});
