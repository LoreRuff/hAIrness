import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type Role = "owner" | "admin" | "user";
export interface Subject { username: string; role: Role }
// Hono env so routers can read the authenticated subject via c.get("user").
export type Env = { Variables: { user: Subject } };

// Browser sessions live in memory only: a restart invalidates them and forces
// a fresh login. Deliberate — no session material ever reaches DB or snapshots.
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const sessions = new Map<string, { username: string; role: Role; issuedAt: number }>();

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // length compare leaks length only; content is timing-safe
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// scrypt with a per-hash random salt; stored as "salt:hex" in users.passHash.
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const i = stored.indexOf(":");
  if (i <= 0) return false;
  const real = Buffer.from(stored.slice(i + 1), "hex");
  const cand = scryptSync(pw, stored.slice(0, i), 32);
  return cand.length === real.length && timingSafeEqual(cand, real);
}

export function createSession(username: string, role: Role): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { username, role, issuedAt: Date.now() });
  if (sessions.size > 64) pruneSessions();
  return token;
}

export function sessionOf(token: string): Subject | null {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.issuedAt > SESSION_TTL_MS) { sessions.delete(token); return null; }
  return { username: s.username, role: s.role };
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

function pruneSessions(): void {
  const now = Date.now();
  for (const [t, s] of sessions) if (now - s.issuedAt > SESSION_TTL_MS) sessions.delete(t);
}

// ---- login throttle (in-memory): after repeated failures the login route
// stalls, so brute force stops paying. No dependencies, resets on restart.
const MAX_FAILS = 5;
const fails = new Map<string, { n: number; until: number }>();

export function loginThrottleMs(user: string): number {
  const f = fails.get(user);
  if (!f || Date.now() >= f.until) return 0;
  return f.until - Date.now();
}

export function recordLoginResult(user: string, ok: boolean): void {
  if (ok) { fails.delete(user); return; }
  const f = fails.get(user) ?? { n: 0, until: 0 };
  f.n += 1;
  f.until = f.n >= MAX_FAILS
    ? Date.now() + Math.min(2 ** (f.n - MAX_FAILS) * 1000, 60_000)
    : 0;
  fails.set(user, f);
}
