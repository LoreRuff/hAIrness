const KEYS = [
  "harness_token", "harness_model", "harness_mode", "harness_system", "harness_temp",
  "harness_enter_send", "harness_active_skills", "harness_soul", "harness_facts",
  "harness_project", "harness_peer", "harness_peer_tok",
];

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("harness_token") || "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Load prefs from the server into localStorage. Call BEFORE the store initializes. */
export async function loadPrefs(): Promise<void> {
  try {
    const r = await fetch("/api/prefs", { headers: authHeaders() });
    if (!r.ok) return;
    const p = (await r.json()) as Record<string, string>;
    for (const k of KEYS) if (p[k] != null) localStorage.setItem(k, p[k]);
  } catch { /* server unreachable — keep local values */ }
}

let timer: number | null = null;
/** Debounced push of all prefs to the server (1s after the last change). */
export function schedulePrefsPush(): void {
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(() => {
    const p: Record<string, string> = {};
    for (const k of KEYS) {
      const v = localStorage.getItem(k);
      if (v != null) p[k] = v;
    }
    fetch("/api/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(p),
    }).catch(() => {});
  }, 1000);
}
