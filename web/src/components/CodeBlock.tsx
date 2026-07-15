import { useEffect, useRef, useState } from "react";
import { codeToHtml } from "shiki";

let pyodidePromise: Promise<any> | null = null;
function getPyodide(): Promise<any> {
  if (!pyodidePromise) {
    pyodidePromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("pyodide load failed"));
      document.head.appendChild(s);
    }).then(() =>
      (window as any).loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" })
    );
  }
  return pyodidePromise;
}

const RUNNABLE = new Set(["js", "javascript", "python", "py"]);

export default function CodeBlock({ lang, code, streaming }: { lang: string; code: string; streaming?: boolean }) {
  const [html, setHtml] = useState("");
  const [out, setOut] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (streaming) return; // plain <pre> while streaming, highlight at the end
    let alive = true;
    codeToHtml(code, { lang: normalizeLang(lang), theme: "github-dark" })
      .then((h) => { if (alive) setHtml(h); })
      .catch(() => { if (alive) setHtml(""); });
    return () => { alive = false; };
  }, [code, lang, streaming]);

  function normalizeLang(l: string): string {
    const m: Record<string, string> = { js: "javascript", py: "python", ts: "typescript", sh: "bash" };
    return m[l] ?? (l || "text");
  }

  async function run() {
    setRunning(true);
    setOut("");
    const l = normalizeLang(lang);
    try {
      if (l === "javascript") {
        await runJs();
      } else if (l === "python") {
        const py = await getPyodide();
        const lines: string[] = [];
        py.setStdout({ batched: (s: string) => lines.push(s) });
        py.setStderr({ batched: (s: string) => lines.push(s) });
        try {
          const r = await py.runPythonAsync(code);
          if (r !== undefined && r !== null) lines.push(String(r));
        } catch (e: any) {
          lines.push(String(e?.message ?? e));
        }
        setOut(lines.join("\n") || "(no output)");
      }
    } catch (e: any) {
      setOut("Error: " + String(e?.message ?? e));
    } finally {
      setRunning(false);
    }
  }

  function runJs(): Promise<void> {
    return new Promise((resolve) => {
      const id = "run-" + Math.random().toString(36).slice(2);
      const onMsg = (ev: MessageEvent) => {
        if (ev.data?.harnessRun && ev.data.id === id) {
          setOut((ev.data.logs as string[]).join("\n") || "(no output)");
          window.removeEventListener("message", onMsg);
          iframeRef.current?.remove();
          iframeRef.current = null;
          resolve();
        }
      };
      window.addEventListener("message", onMsg);
      const srcdoc = `<script>
        const logs = [];
        const fmt = (a) => a.map(x => { try { return typeof x === "object" ? JSON.stringify(x) : String(x); } catch { return String(x); } }).join(" ");
        console.log = console.error = console.warn = console.info = (...a) => logs.push(fmt(a));
        (async () => {
          try {
            let r = eval(${JSON.stringify(code)});
            if (r instanceof Promise) r = await r;
            if (r !== undefined) logs.push(String(r));
          } catch (e) { logs.push("Error: " + e.message); }
          parent.postMessage({ harnessRun: true, id: ${JSON.stringify(id)}, logs }, "*");
        })();
      <\/script>`;
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.style.display = "none";
      iframe.srcdoc = srcdoc;
      iframeRef.current = iframe;
      document.body.appendChild(iframe);
      setTimeout(() => { // safety timeout
        window.removeEventListener("message", onMsg);
        iframe.remove();
        resolve();
      }, 10_000);
    });
  }

  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="codeblock-lang">{lang || "text"}</span>
        <div>
          <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(code)}>copy</button>
          {RUNNABLE.has(lang) && !streaming && (
            <button className="btn-ghost" onClick={run} disabled={running}>
              {running ? "running…" : "▶ run"}
            </button>
          )}
        </div>
      </div>
      {streaming || !html
        ? <pre className="codeblock-pre"><code>{code}</code></pre>
        : <div className="codeblock-shiki" dangerouslySetInnerHTML={{ __html: html }} />}
      {out !== null && <pre className="codeblock-out">{out}</pre>}
    </div>
  );
}
