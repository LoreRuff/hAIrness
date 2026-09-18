import { db } from "../db.ts";
import { config } from "../config.ts";
import type { Subject } from "./auth.ts";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export type BudgetVerdict =
  | { ok: true }
  | { ok: false; resetAt: number; scope: "user" | "global" };

// H4 token budget: prompt+completion tokens billed to this user in the last
// hour, from the tasks log. The owner is never limited; a user without a
// positive quota is unlimited too (quotaTokensPerHour NULL/0 = off).
// The global daily cap (MAX_TOKENS_PER_DAY) sits in the same gate so every
// billing point checks both with one call; unlike the hourly quota it applies
// to everyone, owner included — it protects the OpenRouter account itself.
export function checkTokenBudget(s: Subject | undefined): BudgetVerdict {
  if (s && s.role !== "owner") {
    const u = db.prepare(`SELECT quotaTokensPerHour FROM users WHERE username = ? AND active = 1`)
      .get(s.username) as any;
    const quota = u?.quotaTokensPerHour ?? 0;
    if (quota > 0) {
      const since = Date.now() - HOUR;
      const spent = (db.prepare(
        `SELECT COALESCE(sum(promptTokens + completionTokens), 0) AS t FROM tasks WHERE user = ? AND at > ?`
      ).get(s.username, since) as any).t;
      if (spent >= quota) {
        // The window frees when the oldest billable task of this hour falls out.
        const oldest = (db.prepare(
          `SELECT min(at) AS at FROM tasks WHERE user = ? AND at > ?`
        ).get(s.username, since) as any).at;
        return { ok: false, resetAt: (oldest ?? Date.now()) + HOUR, scope: "user" };
      }
    }
  }
  const cap = config.budget.maxTokensPerDay;
  if (cap > 0) {
    const dayStart = Math.floor(Date.now() / DAY) * DAY; // UTC day
    const spent = (db.prepare(
      `SELECT COALESCE(sum(promptTokens + completionTokens), 0) AS t FROM tasks WHERE at > ?`
    ).get(dayStart) as any).t;
    if (spent >= cap) return { ok: false, resetAt: dayStart + DAY, scope: "global" };
  }
  return { ok: true };
}

// One wording for every gate so clients can key on scope without parsing.
export function budgetMessage(tb: { scope: "user" | "global" }): string {
  return tb.scope === "global"
    ? "global daily token budget exhausted"
    : "token budget exhausted for this hour";
}

// Per-user token bucket on /api/* (health/auth excluded upstream). Refill is
// continuous: tokens accrue at cap/min since the last visit. Owner exempt.
const buckets = new Map<string, { tokens: number; last: number }>();

export function rateLimit(s: Subject | undefined): { ok: true } | { ok: false; retryAfter: number } {
  if (!s || s.role === "owner") return { ok: true };
  const cap = s.role === "admin" ? config.budget.ratePerMinAdmin : config.budget.ratePerMinUser;
  if (cap <= 0) return { ok: true };
  const now = Date.now();
  const b = buckets.get(s.username) ?? { tokens: cap, last: now };
  b.tokens = Math.min(cap, b.tokens + ((now - b.last) / 60_000) * cap);
  b.last = now;
  buckets.set(s.username, b);
  if (b.tokens < 1) {
    return { ok: false, retryAfter: Math.ceil((((1 - b.tokens) * 60_000) / cap) / 1000) };
  }
  b.tokens -= 1;
  return { ok: true };
}
