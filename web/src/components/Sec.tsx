import type { ReactNode } from "react";

// Shared accordion section (chat Inspector + node Config): the current state
// stays visible in the summary, content is one click away. <details> is
// native — no extra JS, keyboard and a11y for free.
export default function Sec(props: { title: string; val?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="insp-sec" open={props.open}>
      <summary>
        {props.title}
        {props.val ? <span className="insp-sec-val">{props.val}</span> : null}
      </summary>
      <div className="insp-sec-body">{props.children}</div>
    </details>
  );
}
