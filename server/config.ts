import "dotenv/config";
import { nanoid } from "nanoid";

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  nodeId: process.env.NODE_ID ?? `node-${nanoid(8)}`,
  dbPath: process.env.DB_PATH ?? "./data/harness.db",
  authToken: (process.env.HARNESS_TOKEN ?? "").trim(), // empty = auth disabled
  openrouter: {
    apiKey: (process.env.OPENROUTER_API_KEY ?? "").trim(),
    baseUrl: "https://openrouter.ai/api/v1",
    siteUrl: process.env.OR_SITE_URL ?? "http://localhost:8787",
    appTitle: process.env.OR_APP_TITLE ?? "AI Harness",
  },
} as const;
