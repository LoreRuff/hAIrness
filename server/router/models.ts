import { Hono } from "hono";
import { listModels } from "../core/openrouter.ts";

export const models = new Hono();

// Backlog: OpenRouter's catalog is big and slow — cache it and refetch in the
// background. Fresh < 15 min, stale-but-usable < 24 h, only then fail.
const FRESH_MS = 15 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
let cache: { at: number; items: any[] } | null = null;
let refresh: Promise<void> | null = null;

async function refreshCache(): Promise<void> {
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
    reasoningEfforts: m.reasoning?.supported_efforts ?? [],
  }));
  cache = { at: Date.now(), items };
}

models.get("/", async (c) => {
  if (cache && Date.now() - cache.at < FRESH_MS) return c.json({ items: cache.items });
  if (!refresh) {
    // Single-flight: concurrent GETs share one refetch. Failures are absorbed
    // below via the stale cache instead of surfacing a 502.
    refresh = refreshCache().finally(() => { refresh = null; });
  }
  try {
    await refresh;
    return c.json({ items: cache!.items });
  } catch (e: any) {
    if (cache && Date.now() - cache.at < STALE_MS) return c.json({ items: cache.items });
    return c.json({ error: String(e?.message ?? e) }, 502);
  }
});
