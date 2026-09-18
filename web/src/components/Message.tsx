import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Usage } from "../types";
import CodeBlock from "./CodeBlock";

interface Seg { type: "text" | "code"; lang?: string; body: string; closed?: boolean }

function ToolResultBody({ content }: { content: string }) {
  let pretty = content;
  try { pretty = JSON.stringify(JSON.parse(content), null, 2); } catch { /* keep raw */ }
  return <pre className="tool-result-body">{pretty}</pre>;
}

function parseSegments(content: string): Seg[] {
  const segs: Seg[] = [];
  const re = /```(\w*)[^\S\n]*\n([\s\S]*?)(```|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (m.index > last) segs.push({ type: "text", body: content.slice(last, m.index) });
    segs.push({ type: "code", lang: m[1] || "text", body: m[2], closed: m[3] === "```" });
    last = re.lastIndex;
  }
  if (last < content.length) segs.push({ type: "text", body: content.slice(last) });
  return segs;
}

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function click() {
    if (armed) {
      if (timer.current) clearTimeout(timer.current);
      onDelete();
    } else {
      setArmed(true);
      timer.current = window.setTimeout(() => setArmed(false), 2500);
    }
  }

  return (
    <button
      className={armed ? "btn-ghost msg-del armed" : "btn-ghost msg-del"}
      title={armed ? "Click again to delete" : "Remove from context"}
      onClick={click}
      onMouseLeave={() => { if (armed) { if (timer.current) clearTimeout(timer.current); setArmed(false); } }}
    >
      {armed ? "sure?" : "✕"}
    </button>
  );
}

// Reasoning (CoT) view. While the model is streaming, the block opens itself
// and pins to the newest token so the thinking is visible live; once done it
// collapses unless the user re-opens it. Clicking anywhere inside collapses it
// (unless the user is mid text-selection, which must keep working).
function Thinking({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(Boolean(streaming));
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const downAt = useRef({ x: 0, y: 0 });
  useEffect(() => { setOpen(Boolean(streaming)); }, [streaming]);
  useEffect(() => {
    if (open && streaming && bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, open, streaming]);
  return (
    <details className="thinking" open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      onMouseDown={(e) => { downAt.current = { x: e.clientX, y: e.clientY }; }}
      onClick={(e) => {
        // Click anywhere collapses. A drag (text selection) must not: it moves.
        const moved = Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y);
        if (moved < 5 && !window.getSelection()?.toString()) setOpen(false);
      }}>
      <summary>💭 thinking</summary>
      <div className="thinking-body" ref={bodyRef}>{text}</div>
    </details>
  );
}

export default function Message({ msg, usage, streaming, onDelete }: {
  msg: ChatMessage; usage?: Usage; streaming?: boolean; onDelete?: () => void;
}) {
  const segs = parseSegments(msg.content);
  const atts = msg.attachments ?? [];
  const label = msg.role === "user" ? "you" : msg.role === "tool" ? "tool" : "harness";
  return (
    <div className={`msg msg-${msg.role}`}>
      <div className="msg-head">
        <span className="msg-role">{label}</span>
        {onDelete && <DeleteButton onDelete={onDelete} />}
      </div>
      {msg.reasoning && <Thinking text={msg.reasoning} streaming={streaming} />}
      {(msg.toolCalls?.length ?? 0) > 0 && (
        <div className="tool-row">
          {msg.toolCalls!.map((tc) => {
            const q = typeof tc.args.query === "string" ? tc.args.query : JSON.stringify(tc.args);
            return (
              <span key={tc.id} className="tool-chip">
                🔍 {tc.name}: “{q}”
              </span>
            );
          })}
        </div>
      )}
      {msg.role === "tool" && (
        <div className="tool-result">
          <ToolResultBody content={msg.content} />
        </div>
      )}
      {atts.length > 0 && (
        <div className="att-row">
          {atts.map((a) =>
            a.kind === "image"
              ? <img key={a.id} src={a.dataUrl} alt={a.name} className="att-preview" />
              : <span key={a.id} className="att-chip">📄 <span className="att-name">{a.name}</span></span>
          )}
        </div>
      )}
      <div className="msg-body">
        {segs.map((s, i) =>
          s.type === "code"
            ? <CodeBlock key={i} lang={s.lang!} code={s.body} streaming={streaming && !s.closed} />
            : <div key={i} className="msg-text">{s.body}</div>
        )}
        {streaming && <span className="cursor">▌</span>}
      </div>
      {usage && (
        <div className="msg-meta">
          {usage.model} · {usage.promptTokens}→{usage.completionTokens} tok
          · cached {usage.cachedTokens} ({usage.cachedPct}%)
          · ${usage.costUsd.toFixed(5)}
        </div>
      )}
    </div>
  );
}
