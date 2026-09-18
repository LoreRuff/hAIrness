// QA for the compare-view diff: symmetric additions/removals and the
// interleaved case are where a hand-rolled LCS usually breaks.
import { describe, expect, test } from "bun:test";
import { diffLines } from "./diff.ts";

describe("diffLines", () => {
  test("identical text -> all same rows", () => {
    const rows = diffLines("a\nb", "a\nb");
    expect(rows.every((r) => r.type === "same")).toBe(true);
    expect(rows.map((r) => r.text)).toEqual(["a", "b"]);
  });
  test("added lines marked add", () => {
    const rows = diffLines("a", "a\nb");
    expect(rows.filter((r) => r.type === "add").map((r) => r.text)).toEqual(["b"]);
    expect(rows.some((r) => r.type === "del")).toBe(false);
  });
  test("removed lines marked del", () => {
    const rows = diffLines("a\nb\nc", "a\nc");
    expect(rows.filter((r) => r.type === "del").map((r) => r.text)).toEqual(["b"]);
  });
  test("rebuild: same + del + add reconstruct both inputs", () => {
    const a = "uno\ndue\ttre\nquattro\nfine";
    const b = "uno\nDUE\ntre\nquattro\nquinto\nfine";
    const rows = diffLines(a, b);
    const left = rows.filter((r) => r.type !== "add").map((r) => r.text).join("\n");
    const right = rows.filter((r) => r.type !== "del").map((r) => r.text).join("\n");
    expect(left).toBe(a);
    expect(right).toBe(b);
  });
});
