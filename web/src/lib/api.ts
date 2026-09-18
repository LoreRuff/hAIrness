export const getToken = () => localStorage.getItem("harness_token") || "";
function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const t = getToken();
  if (t) h["Authorization"] = `Bearer ${t}`;
  return h;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...headers(), ...(init?.headers as any) } });
  // Session expired or invalid: drop it and restart from the login gate.
  // The boot check and the login call bypass api() so this cannot loop.
  if (res.status === 401) {
    localStorage.removeItem("harness_token");
    window.location.reload();
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    // Server validation errors carry a JSON {error}; surface it so callers
    // can show the real reason (e.g. "cannot revoke yourself") inline.
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `${path} → HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const apiGet = <T,>(path: string) => api<T>(path);
export const apiPost = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const apiPut = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const apiPatch = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const apiDelete = (path: string) => api<{ ok: boolean }>(path, { method: "DELETE" });
