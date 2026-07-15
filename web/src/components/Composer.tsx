import { useState } from "react";
import { useStore } from "../lib/store";

export default function Composer({ onSend, onStop }: {
  onSend: (text: string) => void; onStop: () => void;
}) {
  const [text, setText] = useState("");
  const streaming = useStore((s) => s.streaming);

  function submit() {
    const t = text.trim();
    if (!t || streaming) return;
    setText("");
    onSend(t);
  }

  return (
    <div className="composer">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
        placeholder="Message… (Enter to send, Shift+Enter for newline)"
        rows={3}
      />
      {streaming
        ? <button className="btn btn-stop" onClick={onStop}>■ stop</button>
        : <button className="btn" onClick={submit}>send ▶</button>}
    </div>
  );
}
