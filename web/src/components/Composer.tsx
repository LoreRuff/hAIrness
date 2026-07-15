import { useRef, useState } from "react";
import { useStore } from "../lib/store";
import { fileToAttachment } from "../lib/files";
import type { Attachment } from "../types";

export default function Composer({ onSend, onStop }: {
  onSend: (text: string, attachments: Attachment[]) => void; onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const streaming = useStore((s) => s.streaming);
  const enterToSend = useStore((s) => s.enterToSend);
  const toggleEnterToSend = useStore((s) => s.toggleEnterToSend);

  async function addFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      const r = await fileToAttachment(f);
      if ("error" in r) alert(r.error);
      else setAtts((prev) => [...prev, r]);
    }
  }

  function submit() {
    const t = text.trim();
    if ((!t && atts.length === 0) || streaming) return;
    setText("");
    setAtts([]);
    onSend(t, atts);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    const sendCombo = enterToSend ? !e.shiftKey : e.shiftKey;
    if (sendCombo) { e.preventDefault(); submit(); }
    // otherwise: default behaviour = newline
  }

  return (
    <div
      className={drag ? "composer drag" : "composer"}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
    >
      {atts.length > 0 && (
        <div className="att-row">
          {atts.map((a) => (
            <div key={a.id} className="att-chip">
              {a.kind === "image"
                ? <img src={a.dataUrl} alt={a.name} className="att-thumb" />
                : <span className="att-icon">📄</span>}
              <span className="att-name">{a.name}</span>
              <button className="btn-ghost" onClick={() => setAtts(atts.filter((x) => x.id !== a.id))}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="composer-row">
        <input
          ref={fileRef} type="file" multiple hidden
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        />
        <button className="btn-ghost btn-attach" title="Attach files" onClick={() => fileRef.current?.click()}>📎</button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          placeholder={enterToSend
            ? "Message… (Enter = send · Shift+Enter = newline)"
            : "Message… (Shift+Enter = send · Enter = newline)"}
          rows={3}
        />
        <div className="composer-btns">
          <button
            className="btn-ghost"
            title="Toggle send shortcut"
            onClick={toggleEnterToSend}
          >{enterToSend ? "↵ send" : "⇧↵ send"}</button>
          {streaming
            ? <button className="btn btn-stop" onClick={onStop}>■ stop</button>
            : <button className="btn" onClick={submit}>send ▶</button>}
        </div>
      </div>
    </div>
  );
}
