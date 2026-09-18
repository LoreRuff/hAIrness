import { Hono } from "hono";
import { config } from "../config.ts";
import {
  createSession, destroySession, loginThrottleMs, recordLoginResult, safeEqual,
  sessionOf, verifyPassword, type Env, type Role,
} from "../core/auth.ts";
import { userByUsername, usersCount } from "../db.ts";

export const auth = new Hono<Env>();

function bearer(c: { req: { header: (k: string) => string | undefined } }): string {
  const h = c.req.header("Authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

auth.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const user = String(body.user ?? "");
  const wait = loginThrottleMs(user);
  if (wait > 0) {
    // The stall IS the throttle: brute force pays in wall-clock time.
    await new Promise((r) => setTimeout(r, wait));
    return c.json({ error: "too many failed logins, retry later" }, 429);
  }
  // Users table first (scrypt compare); if the table is somehow empty fall
  // back to the .env owner so a broken seed can't lock the machine out.
  const row = userByUsername(user);
  let ok: boolean;
  let role: Role;
  if (row) {
    // inactive and wrong-password are the same 401: no account enumeration.
    ok = row.active === 1 && verifyPassword(String(body.password ?? ""), row.passHash);
    role = row.role;
  } else {
    ok = usersCount() === 0 &&
      safeEqual(user, config.auth.user) && safeEqual(String(body.password ?? ""), config.auth.password);
    role = "owner";
  }
  recordLoginResult(user, ok);
  if (!ok) return c.json({ error: "invalid credentials" }, 401);
  return c.json({ ok: true, token: createSession(user, role), user, role });
});

auth.get("/session", (c) => {
  const t = bearer(c);
  const s = t ? sessionOf(t) : null;
  if (!s) return c.json({ error: "unauthorized" }, 401);
  return c.json({ ok: true, user: s.username, role: s.role });
});

auth.post("/logout", (c) => {
  destroySession(bearer(c));
  return c.json({ ok: true });
});
