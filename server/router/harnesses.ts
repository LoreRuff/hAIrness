import { Hono } from "hono";
import { crudRouter } from "./crud.ts";
import { getRow, getVersion, listRows, listVersions, upsertRow, versionHarness, type TableName } from "../db.ts";
import { nanoid } from "nanoid";
import type { Harness, MemoryFile, PromptFile, Skill } from "../../shared/types.ts";

const r = crudRouter("harnesses", (row) => versionHarness(row as { id: string }));

/* immutable history of one harness */
r.get("/:id/versions", (c) => {
  return c.json({ items: listVersions(c.req.param("id")) });
});

/* set head = snapshot content (id persists, rev bumps so sync propagates) */
r.post("/:id/restore/:versionId", (c) => {
  const v = getVersion(c.req.param("versionId"));
  if (!v || v.id !== c.req.param("id")) return c.json({ error: "version not found" }, 404);
  const head = {
    ...v,
    rev: (v.rev ?? 0) + 1,
    updatedAt: Date.now(),
    nodeOrigin: "restore",
  } as Harness;
  upsertRow("harnesses" as TableName, head);
  versionHarness(head);
  return c.json(getRow("harnesses" as TableName, head.id));
});

/* harness.json — self-contained export: references resolved inline */
r.get("/:id/export", (c) => {
  const h = getRow<Harness>("harnesses" as TableName, c.req.param("id"));
  if (!h) return c.json({ error: "not found" }, 404);
  const mem = listRows<MemoryFile>("memory_files");
  const refs = {
    skills: h.skills.map((id) => listRows<Skill>("skills").find((s) => s.id === id)).filter(Boolean),
    prompts: (h.promptIds ?? []).map((id) => listRows<PromptFile>("prompts").find((p) => p.id === id)).filter(Boolean),
    soul: h.memory.soul ? mem.find((m) => m.id === h.memory.soul) ?? null : null,
    facts: h.memory.facts.map((id) => mem.find((m) => m.id === id)).filter(Boolean),
  };
  return c.json({ schemaVersion: 1, exportedAt: Date.now(), harness: h, refs });
});

/* import: create a NEW harness (new id) from an export blob — never overwrites */
r.post("/import", async (c) => {
  const blob = (await c.req.json()) as { harness?: Partial<Harness> };
  if (!blob.harness) return c.json({ error: "missing harness" }, 400);
  const h: Harness = {
    name: blob.harness.name ?? "imported",
    rev: 0,
    model: blob.harness.model ?? "",
    systemMode: blob.harness.systemMode ?? "append",
    system: blob.harness.system,
    promptIds: blob.harness.promptIds,
    skills: blob.harness.skills ?? [],
    memory: blob.harness.memory ?? { soul: null, facts: [] },
    tools: blob.harness.tools ?? [],
    reasoning: blob.harness.reasoning,
    temperature: blob.harness.temperature,
    id: nanoid(12),
    updatedAt: Date.now(),
    nodeOrigin: "import",
  };
  upsertRow("harnesses", h);
  versionHarness(h);
  return c.json(h);
});

export const harnesses = r;
