export * from "../../shared/types";

// Auth role as issued by /api/auth and /api/auth/session (NOT the message
// role in shared/types — different concept, same word).
export type AuthRole = "owner" | "admin" | "user";

// Client view of a managed user: server never returns passHash (P4-A).
export interface ManagedUser {
  id: string;
  username: string;
  role: AuthRole;
  quotaTokensPerHour: number | null;
  active: 0 | 1;
  createdAt: number;
}

// Run log entry (client-side view of the SSE stream, persisted in graph_runs).
// `at` powers the run timeline (relative offsets).
export interface LogEntry {
  kind: "start" | "output" | "final" | "usage" | "error" | "done" | "human";
  title?: string;
  body?: string;
  at?: number;
}
