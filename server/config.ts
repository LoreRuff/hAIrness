import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  nodeId: process.env.NODE_ID ?? "node-local",
  dbPath: process.env.DB_PATH ?? "./data/harness.db",
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseUrl: "https://openrouter.ai/api/v1",
    siteUrl: process.env.OR_SITE_URL ?? "http://localhost:8787",
    appTitle: process.env.OR_APP_TITLE ?? "AI Harness",
  },
};

if (!config.openrouter.apiKey) {
  console.warn("[config] OPENROUTER_API_KEY is empty — /api/chat will fail until set in .env");
}
