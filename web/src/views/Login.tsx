import { useState } from "react";
import { useStore } from "../lib/store";
import type { AuthRole } from "../types";

export default function Login({ onAuthed }: { onAuthed: () => void }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      // Raw fetch on purpose: api() would bounce a 401 into a reload loop.
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (!r.ok) {
        setMsg(r.status === 429 ? "too many failed logins, retry later" : "invalid credentials");
        return;
      }
      const j = await r.json();
      localStorage.setItem("harness_token", j.token);
      useStore.getState().setRole(j.role as AuthRole);
      onAuthed();
    } catch {
      setMsg("server unreachable");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <div className="login-title">hAIrness</div>
      <input autoFocus placeholder="user" value={user} spellCheck={false}
        onChange={(e) => setUser(e.target.value)} />
      <input type="password" placeholder="password" value={password}
        onChange={(e) => setPassword(e.target.value)} />
      <button className="btn btn-block" disabled={busy || !user || !password}>
        {busy ? "signing in…" : "sign in"}
      </button>
      {msg && <div className="muted login-msg">{msg}</div>}
    </form>
  );
}
