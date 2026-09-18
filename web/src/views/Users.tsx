import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import type { AuthRole, ManagedUser } from "../types";

const EMPTY = { username: "", password: "", role: "user" as AuthRole, quota: "" };

export default function Users() {
  const s = useStore();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [sel, setSel] = useState<string | null>(null); // null = create form
  const [draft, setDraft] = useState(EMPTY);
  const [quota, setQuota] = useState("");
  const [pw, setPw] = useState("");
  const [me, setMe] = useState("");

  // Self username only disables the two controls the server would reject
  // anyway (self-demotion, self-revoke); the server guard stays the truth.
  useEffect(() => {
    apiGet<{ user: string }>("/api/auth/session").then((r) => setMe(r.user)).catch(() => {});
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const { items } = await apiGet<{ items: ManagedUser[] }>("/api/users");
    setUsers(items);
  }

  function ok(msg: string) { s.setToast(msg); }

  function open(u: ManagedUser) {
    setSel(u.id);
    setQuota(u.quotaTokensPerHour == null ? "" : String(u.quotaTokensPerHour));
    setPw("");
  }
  function openNew() { setSel(null); setDraft(EMPTY); }

  async function create() {
    if (!draft.username.trim() || !draft.password) return;
    try {
      const r = await apiPost<{ user: ManagedUser }>("/api/users", {
        username: draft.username.trim(),
        password: draft.password,
        role: draft.role,
        quotaTokensPerHour: draft.quota === "" ? undefined : Number(draft.quota),
      });
      ok(`user ${r.user.username} created`);
      open(r.user);
      await refresh();
    } catch (e: any) { s.setToast(e.message); }
  }

  async function patch(id: string, fields: Record<string, unknown>, msg: string) {
    try {
      await apiPatch(`/api/users/${id}`, fields);
      ok(msg);
      await refresh();
    } catch (e: any) { s.setToast(e.message); }
  }

  async function reset(id: string) {
    if (!pw) return;
    try {
      await apiPost(`/api/users/${id}/reset`, { password: pw });
      ok("password updated");
      setPw("");
    } catch (e: any) { s.setToast(e.message); }
  }

  const selUser = users.find((u) => u.id === sel);
  const isSelf = selUser?.username === me;

  return (
    <main className="panel">
      <div className="panel-list">
        <button className="btn btn-block" onClick={openNew}>+ new user</button>
        {users.map((u) => (
          <div key={u.id} className={u.id === sel ? "item active" : "item"} onClick={() => open(u)}>
            <div className="item-main">
              <div>{u.username}{u.username === me && <span className="muted"> (you)</span>}</div>
              <div className="muted item-sub">
                quota: {u.quotaTokensPerHour == null ? "none" : `${u.quotaTokensPerHour}/h`}
                {u.active === 0 && " · revoked"}
              </div>
            </div>
            <span className={u.active === 0 ? "badge revoked-badge" : `badge badge-${u.role}`}>
              {u.active === 0 ? "revoked" : u.role}
            </span>
          </div>
        ))}
      </div>
      <div className="panel-editor">
        {!selUser ? (
          <>
            <h3>New user</h3>
            <input placeholder="username" value={draft.username} spellCheck={false}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
            <input type="password" placeholder="password" value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
            <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as AuthRole })}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <input type="number" min={0} placeholder="token quota per hour (empty = unlimited)"
              value={draft.quota} onChange={(e) => setDraft({ ...draft, quota: e.target.value })} />
            <div className="row-btns">
              <button className="btn" disabled={!draft.username.trim() || !draft.password} onClick={create}>create</button>
            </div>
          </>
        ) : (
          <>
            <h3>
              {selUser.username}
              <span className={selUser.active === 0 ? "badge revoked-badge" : `badge badge-${selUser.role}`}>
                {selUser.active === 0 ? "revoked" : selUser.role}
              </span>
            </h3>
            <label className="muted user-field-label">role</label>
            <select value={selUser.role} disabled={isSelf}
              onChange={(e) => patch(selUser.id, { role: e.target.value }, `role updated for ${selUser.username}`)}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            {isSelf && <div className="muted user-note">cannot change your own role</div>}
            <label className="muted user-field-label">token quota per hour (empty = unlimited)</label>
            <div className="row-btns">
              <input type="number" min={0} value={quota} onChange={(e) => setQuota(e.target.value)} />
              <button className="btn btn-sm" onClick={() =>
                patch(selUser.id, { quotaTokensPerHour: quota === "" ? null : Number(quota) }, "quota updated")}>save</button>
            </div>
            <label className="muted user-field-label">reset password</label>
            <div className="row-btns">
              <input type="password" placeholder="new password" value={pw}
                onChange={(e) => setPw(e.target.value)} />
              <button className="btn btn-sm" disabled={!pw} onClick={() => reset(selUser.id)}>reset</button>
            </div>
            {!isSelf && (
              <div className="row-btns">
                {selUser.active === 1
                  ? <button className="btn btn-stop" onClick={() =>
                      patch(selUser.id, { active: 0 }, `${selUser.username} revoked`)}>revoke</button>
                  : <button className="btn" onClick={() =>
                      patch(selUser.id, { active: 1 }, `${selUser.username} re-enabled`)}>re-enable</button>}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
