import { Hono } from "hono";
import { listModels } from "../core/openrouter.ts";

export const models = new Hono();

models.get("/", async (c) => {
  try {
    const raw = (await listModels()) as { data?: any[] };
    const items = (raw.data ?? []).map((m) => ({
      id: m.id,
      provider: "openrouter",
      label: m.name ?? m.id,
      contextWindow: m.context_length,
      inputPrice: m.pricing?.prompt ? Number(m.pricing.prompt) * 1_000_000 : undefined,
      outputPrice: m.pricing?.completion ? Number(m.pricing.completion) * 1_000_000 : undefined,
      supportsTools: m.supported_parameters?.includes?.("tools") ?? undefined,
      supportsVision: (m.architecture?.input_modalities ?? []).includes("image"),
    }));
    return c.json({ items });
  } catch (e: any) {
    return c.json({ error: String(e?.message ?? e) }, 502);
  }
});
