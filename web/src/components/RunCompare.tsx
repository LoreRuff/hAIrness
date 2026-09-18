import { useMemo, useState } from "react";
import { diffLines } from "../lib/diff";
import type { LogEntry } from "../types";

export interface CompareRun {
  id: string;
  label: string;
  log: LogEntry[];
}

export function finalsOf(log: LogEntry[]): string {
  return (log ?? [])
    .filter((e) => e.kind === "final")
    .map((e) => e.body ?? "")
    .join("\n\n---\n\n");
}

// Side-by-side finals + unified diff of the two outputs. The diff uses the
// raw bodies (what the graph actually produced), not the rendered cards.
export default function RunCompare({ runs }: { runs: CompareRun[] }) {
  const [leftId, setLeftId] = useState(runs[0]?.id ?? "");
  const [rightId, setRightId] = useState(runs[1]?.id ?? runs[0]?.id ?? "");

  const left = runs.find((r) => r.id === leftId);
  const right = runs.find((r) => r.id === rightId);
  const diff = useMemo(
    () => (left && right ? diffLines(finalsOf(left.log), finalsOf(right.log)) : []),
    [left, right]
  );
  const changed = diff.filter((r) => r.type !== "same").length;

  return (
    <div className="run-compare">
      <div className="row-btns">
        <select value={leftId} onChange={(e) => setLeftId(e.target.value)}>
          {runs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <span className="muted">vs</span>
        <select value={rightId} onChange={(e) => setRightId(e.target.value)}>
          {runs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
      {left && right && (
        <>
          <div className="rc-panes">
            <pre className="rc-pane">{finalsOf(left.log) || "(empty)"}</pre>
            <pre className="rc-pane">{finalsOf(right.log) || "(empty)"}</pre>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            unified diff · {changed} changed line{changed === 1 ? "" : "s"}
          </div>
          <pre className="rc-diff">
            {diff.map((r, i) => (
              <div key={i} className={`rc-${r.type}`}>
                {r.type === "add" ? "+ " : r.type === "del" ? "- " : "  "}{r.text}
              </div>
            ))}
          </pre>
        </>
      )}
    </div>
  );
}
