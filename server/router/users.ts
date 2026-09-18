import { Hono } from "hono";
import { nanoid } from "nanoid";
import { db, insertUser, updateUser, userById, userByUsername } from "../db.ts";
import { hashPassword, type Env, type Role } from "../core/auth.ts";

// "See but not manage" (P4): admins can list users, every mutation stays
// owner-only. Data stays shared: these accounts gate login, attribution and
// quotas, nothing else. Passwords never come back in a response, in any shape.
export const users = new Hono<Env>();

users.use("*", async (c, next) => {
  const role = c.get("user")?.role;
  if (role === "owner" || (role === "admin" && c.req.method === "GET")) return next();
  return c.json({ error: "owner only" }, 403);
});

const ROLES: Role[] = ["owner", "admin", "user"];

function publicUser(u: any) {
  const { passHash: _p, ...rest } = u;
  return rest;
}

users.get("/", (c) => {
  const rows = db.prepare(`SELECT * FROM users ORDER BY createdAt`).all() as any[];
  return c.json({ items: rows.map(publicUser) });
});

users.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({} as any));
  const username = String(b.username ?? "").trim();
  const password = String(b.password ?? "");
  const role = b.role ?? "user";
  const quota = b.quotaTokensPerHour;
  if (!username || !password) return c.json({ error: "username and password are required" }, 400);
  if (!ROLES.includes(role)) return c.json({ error: `role must be one of ${ROLES.join(", ")}` }, 400);
  if (userByUsername(username)) return c.json({ error: "username already exists" }, 400);
  const u = {
    id: nanoid(12),
    username,
    passHash: hashPassword(password),
    role,
    quotaTokensPerHour: quota == null ? null : Number(quota),
    active: 1 as const,
    createdAt: Date.now(),
  };
  insertUser(u);
  return c.json({ ok: true, user: publicUser(u) }, 201);
});

// The owner must never lock themselves out: no self-demotion, no self-revoke.
function selfLockout(me: string, target: any, fields: { role?: Role; active?: 0 | 1 }): string | null {
  if (target.username !== me) return null;
  if (fields.role && fields.role !== "owner") return "cannot demote yourself";
  if (fields.active === 0) return "cannot revoke yourself";
  return null;
}

users.patch("/:id", async (c) => {
  const target = userById(c.req.param("id"));
  if (!target) return c.json({ error: "user not found" }, 404);
  const b = await c.req.json().catch(() => ({} as any));
  const fields: { role?: Role; quotaTokensPerHour?: number | null; active?: 0 | 1; passHash?: string } = {};
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return c.json({ error: `role must be one of ${ROLES.join(", ")}` }, 400);
    fields.role = b.role;
  }
  if (b.quotaTokensPerHour !== undefined) fields.quotaTokensPerHour = b.quotaTokensPerHour == null ? null : Number(b.quotaTokensPerHour);
  if (b.active !== undefined) fields.active = b.active ? 1 : 0;
  if (b.password !== undefined) {
    if (!String(b.password)) return c.json({ error: "password cannot be empty" }, 400);
    fields.passHash = hashPassword(String(b.password));
  }
  const lock = selfLockout(c.get("user")!.username, target, fields);
  if (lock) return c.json({ error: lock }, 400);
  updateUser(target.id, fields);
  return c.json({ ok: true, user: publicUser(userById(target.id)) });
});

users.post("/:id/reset", async (c) => {
  const target = userById(c.req.param("id"));
  if (!target) return c.json({ error: "user not found" }, 404);
  const b = await c.req.json().catch(() => ({} as any));
  const password = String(b.password ?? "");
  if (!password) return c.json({ error: "password is required" }, 400);
  updateUser(target.id, { passHash: hashPassword(password) });
  return c.json({ ok: true });
});

// Soft delete only: active=0 revokes login while keeping attribution history
// (tasks.user rows still point at this username).
users.delete("/:id", (c) => {
  const target = userById(c.req.param("id"));
  if (!target) return c.json({ error: "user not found" }, 404);
  if (target.username === c.get("user")!.username) return c.json({ error: "cannot revoke yourself" }, 400);
  updateUser(target.id, { active: 0 });
  return c.json({ ok: true });
});
