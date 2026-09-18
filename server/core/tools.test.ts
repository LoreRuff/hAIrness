import { describe, expect, test } from "bun:test";
import { applyToolCallDelta, clampInt, parseWebSearchArgs, type ToolCallAccum } from "./tools.ts";

describe("clampInt", () => {
  test("clamps into range and falls back on garbage", () => {
    expect(clampInt(50, 1, 10, 5)).toBe(10);
    expect(clampInt(0, 1, 10, 5)).toBe(1);
    expect(clampInt(7.4, 1, 10, 5)).toBe(7); // rounds before clamping
    expect(clampInt("abc", 1, 10, 5)).toBe(5);
    expect(clampInt(undefined, 1, 10, 5)).toBe(5);
  });
});

describe("parseWebSearchArgs", () => {
  test("accepts query + optional max_results", () => {
    expect(parseWebSearchArgs({ query: " redis  ", max_results: 3 })).toEqual({
      query: "redis",
      maxResults: 3,
    });
    expect(parseWebSearchArgs({ query: "x" })).toEqual({ query: "x", maxResults: 5 });
  });

  test("accepts camelCase fallback and rejects missing query", () => {
    expect(parseWebSearchArgs({ query: "q", maxResults: 20 }).maxResults).toBe(10);
    expect(() => parseWebSearchArgs({})).toThrow();
    expect(() => parseWebSearchArgs({ query: "   " })).toThrow();
  });
});

describe("applyToolCallDelta", () => {
  test("reassembles one call fragmented across chunks", () => {
    const calls: ToolCallAccum = new Map();
    applyToolCallDelta(calls, { index: 0, id: "call_1", function: { name: "web_search", arguments: '{"qu' } });
    applyToolCallDelta(calls, { index: 0, function: { arguments: 'ery": "red' } });
    applyToolCallDelta(calls, { index: 0, function: { arguments: 'is"}' } });
    expect([...calls.values()]).toEqual([
      { id: "call_1", name: "web_search", args: '{"query": "redis"}' },
    ]);
  });

  test("keeps parallel calls separate by index", () => {
    const calls: ToolCallAccum = new Map();
    applyToolCallDelta(calls, { index: 0, id: "a", function: { name: "web_search", arguments: '{"query":"x"}' } });
    applyToolCallDelta(calls, { index: 1, id: "b", function: { name: "web_search", arguments: '{"query":"y"}' } });
    expect(calls.size).toBe(2);
    expect(calls.get(0)!.args).toBe('{"query":"x"}');
    expect(calls.get(1)!.args).toBe('{"query":"y"}');
  });

  test("defaults missing index to 0", () => {
    const calls: ToolCallAccum = new Map();
    applyToolCallDelta(calls, { id: "z", function: { name: "web_search", arguments: "{}" } });
    expect(calls.get(0)!.id).toBe("z");
  });
});
