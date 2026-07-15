import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.ts";
import { config } from "../config.ts";

export interface SnapshotInfo { name: string; size: number; at: number }

function listDir(dir: string): SnapshotInfo[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith("harness-") && f.endsWith(".db"))
      .map((name) => {
        const st = statSync(join(dir, name));
        return { name, size: st.size, at: st.mtimeMs };
      })
      .sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

export function listSnapshots(): SnapshotInfo[] {
  return listDir(config.snapshots.dir);
}

function prune(dir: string): void {
  for (const s of listDir(dir).slice(config.snapshots.keep)) {
    try { unlinkSync(join(dir, s.name)); } catch { /* ignore */ }
  }
}

async function uploadB2(path: string, name: string): Promise<void> {
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

export async function makeSnapshot(): Promise<{ file: string; uploaded: boolean; mirrored: boolean }> {
  mkdirSync(config.snapshots.dir, { recursive: true });
  const name = `harness-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  const path = join(config.snapshots.dir, name);
  await db.backup(path);          // consistent hot snapshot (WAL-safe)
  prune(config.snapshots.dir);

  // mirror to an external dir (survives repo redeploys)
  let mirrored = false;
  if (config.snapshots.mirrorDir) {
    try {
      mkdirSync(config.snapshots.mirrorDir, { recursive: true });
      copyFileSync(path, join(config.snapshots.mirrorDir, name));
      copyFileSync(path, join(config.snapshots.mirrorDir, "harness-latest.db"));
      prune(config.snapshots.mirrorDir);
      mirrored = true;
    } catch (e: any) {
      console.error("[snapshot] mirror failed:", e?.message ?? e);
    }
  }

  let uploaded = false;
  if (config.b2.enabled) {
    await uploadB2(path, name);
    uploaded = true;
  }
  return { file: name, uploaded, mirrored };
}

export function startSnapshotScheduler(): void {
  const min = config.snapshots.intervalMin;
  if (min <= 0) return;
  const t = setInterval(() => {
    makeSnapshot().catch((e) => console.error("[snapshot]", e?.message ?? e));
  }, min * 60_000);
  t.unref();
  console.log(
    `[harness] snapshot scheduler: every ${min} min (keep ${config.snapshots.keep}` +
    `${config.snapshots.mirrorDir ? `, mirror: ${config.snapshots.mirrorDir}` : ""}` +
    `, B2: ${config.b2.enabled ? "on" : "off"})`
  );
}
