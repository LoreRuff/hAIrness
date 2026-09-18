// QA for the variable template engine: the paths that break silently are
// unresolved keys (must fail loud) and alias slug collisions (must stay
// deterministic — the alias is what users type into inputTemplate).
import { describe, expect, test } from "bun:test";
import { availableKeys, collectPlaceholders, resolveTemplate, slugify } from "./variables.ts";
import type { SingleNode } from "./types.ts";

const node: SingleNode = {
  id: "n_ab12cd34", type: "single", name: "Curatore 1", systemMode: "append", model: "m",
  skills: [], memory: { soul: null, facts: [] }, tools: [], inputs: [], outputs: [],
};

describe("slugify", () => {
  test("node names become readable aliases", () => {
    expect(slugify("Curatore 1")).toBe("curatore_1");
    expect(slugify("  Draft -- review  ")).toBe("draft_review");
  });
  test("empty/odd names fall back to a stable key", () => {
    expect(slugify("   ")).toBe("node");
    expect(slugify("???")).toBe("node");
  });
});

describe("resolveTemplate", () => {
  test("resolves var and output placeholders", () => {
    const vars = new Map([["var.topic", "redis"], ["n1.output", "hello"]]);
    expect(resolveTemplate("Topic: {{var.topic}} / prev: {{n1.output}}", vars))
      .toBe("Topic: redis / prev: hello");
  });
  test("tolerates whitespace inside braces and absent text", () => {
    const vars = new Map([["var.a", "x"]]);
    expect(resolveTemplate("{{ var.a }}", vars)).toBe("x");
    expect(resolveTemplate(undefined, vars)).toBe("");
  });
  test("missing key fails loud with the key name (no silent empty)", () => {
    expect(() => resolveTemplate("hi {{var.nope}}", new Map()))
      .toThrow(/unresolved variable .*var\.nope/);
  });
  test("unknown placeholder syntax passes through untouched", () => {
    // single braces are content, not a template
    expect(resolveTemplate("css { color: red }", new Map())).toBe("css { color: red }");
  });
});

describe("collectPlaceholders", () => {
  test("unique keys in order of appearance", () => {
    expect(collectPlaceholders("{{b}} {{a}} {{b}}")).toEqual(["b", "a"]);
    expect(collectPlaceholders(undefined)).toEqual([]);
  });
});

describe("availableKeys", () => {
  test("run vars + output id + name alias", () => {
    const vars = new Map([["var.topic", "t"]]);
    const outputs = new Map([["n_ab12cd34", "out"]]);
    const byId = new Map([[node.id, node]]);
    expect(availableKeys(node, vars, outputs, byId)).toEqual([
      "var.topic", "n_ab12cd34.output", "curatore_1.output",
    ]);
  });
});
