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

export default function Message({ msg, usage, streaming }: {
  msg: ChatMessage; usage?: Usage; streaming?: boolean;
}) {
  const segs = parseSegments(msg.content);
  return (
    <div className={`msg msg-${msg.role}`}>
      <div className="msg-role">{msg.role === "user" ? "you" : "harness"}</div>
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
