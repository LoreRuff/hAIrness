import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Usage } from "../types";
import CodeBlock from "./CodeBlock";

interface Seg { type: "text" | "code"; lang?: string; body: string; closed?: boolean }

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

export default function Message({ msg, usage, streaming, onDelete }: {
  msg: ChatMessage; usage?: Usage; streaming?: boolean; onDelete?: () => void;
}) {
  const segs = parseSegments(msg.content);
  const atts = msg.attachments ?? [];
  return (
    <div className={`msg msg-${msg.role}`}>
      <div className="msg-head">
        <span className="msg-role">{msg.role === "user" ? "you" : "harness"}</span>
        {onDelete && <DeleteButton onDelete={onDelete} />}
      </div>
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
