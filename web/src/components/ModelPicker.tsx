import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";

// Model selector as a searchable list (model-selector pattern): single click
// opens, each letter filters live, mouseDown selects before blur can close.
// Enter commits the typed id verbatim — free-text model ids stay possible.
export default function ModelPicker(props: { value: string; onChange: (m: string) => void }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(props.value);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setQ(props.value); }, [props.value]);

  // Click-outside dismiss: the input must not force aiming at itself to close.
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const needle = q.trim().toLowerCase();
  const list = s.models.filter((m) =>
    !needle || m.id.toLowerCase().includes(needle) || m.label.toLowerCase().includes(needle));

  return (
    <div className="model-pick" ref={rootRef}>
      <input value={q} spellCheck={false} placeholder="model id" aria-label="model"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && q.trim()) {
            props.onChange(q.trim());
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") setOpen(false);
        }} />
      {open && (
        <div className="picker">
          <div className="picker-head">{list.length} models</div>
          {list.length === 0 && <div className="muted picker-empty">no match — Enter uses the typed id</div>}
          {list.map((m) => (
            <div key={m.id} className={m.id === props.value ? "pick on" : "pick"}
              onMouseDown={(e) => {
                e.preventDefault();
                props.onChange(m.id);
                setOpen(false);
              }}>
              {m.label}
              {m.inputPrice != null && (
                <span className="muted"> · ${m.inputPrice.toFixed(2)}/${(m.outputPrice ?? 0).toFixed(2)} per 1M</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
