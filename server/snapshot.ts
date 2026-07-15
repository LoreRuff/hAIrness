import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.ts";
import { config } from "../config.ts";

export interface SnapshotInfo { name: string; size: number; at: number }

export function listSnapshots(): SnapshotInfo[] {
  try {
    return readdirSync(config.snapshots.dir)
      .filter((f) => f.endsWith(".db"))
      .map((name) => {
        const st = statSync(join(config.snapshots.dir, name));
        return { name, size: st.size, at: st.mtimeMs };
      })
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

function prune(): void {
  const snaps = listSnapshots();
  for (const s of snaps.slice(config.snapshots.keep)) {
    try { unlinkSync(join(config.snapshots.dir, s.name)); } catch { /* ignore */ }
  }
}

async function uploadB2(path: string, name: string): Promise<void> {
  // dynamic import: @aws-sdk/client-s3 is only needed if B2 is configured
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    endpoint: config.b2.endpoint,
    region: config.b2.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.b2.keyId, secretAccessKey: config.b2.appKey },
  });
  await s3.send(new PutObjectCommand({
    Bucket: config.b2.bucket,
    Key: `snapshots/${name}`,
    Body: readFileSync(path),
    ContentType: "application/octet-stream",
  }));
}

export async function makeSnapshot(): Promise<{ file: string; uploaded: boolean }> {
  mkdirSync(config.snapshots.dir, { recursive: true });
  const name = `harness-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  const path = join(config.snapshots.dir, name);
  await db.backup(path);          // consistent hot snapshot (WAL-safe)
  prune();
  let uploaded = false;
  if (config.b2.enabled) {
    await uploadB2(path, name);
    uploaded = true;
  }
  return { file: name, uploaded };
}

export function startSnapshotScheduler(): void {
  const min = config.snapshots.intervalMin;
  if (min <= 0) return;
  const t = setInterval(() => {
    makeSnapshot().catch((e) => console.error("[snapshot]", e?.message ?? e));
  }, min * 60_000);
  t.unref();
  console.log(`[harness] snapshot scheduler: every ${min} min (keep ${config.snapshots.keep}, B2: ${config.b2.enabled ? "on" : "off"})`);
}
