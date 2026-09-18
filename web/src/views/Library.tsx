import { useState } from "react";
import Prompts from "./Prompts";
import Skills from "./Skills";
import Soul from "./Soul";
import Facts from "./Facts";
import AutoMemory from "./AutoMemory";
import Projects from "./Projects";

type Tab = "prompts" | "skills" | "soul" | "facts" | "memory" | "projects";
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "prompts", icon: "📜", label: "Prompts" },
  { id: "skills", icon: "⚡", label: "Skills" },
  { id: "soul", icon: "🫀", label: "Soul" },
  { id: "facts", icon: "📎", label: "Facts" },
  { id: "memory", icon: "🧠", label: "Memory" },
  { id: "projects", icon: "📁", label: "Projects" },
];

function lsTab(): Tab {
  const v = localStorage.getItem("harness_library_tab");
  // N2: "memory" used to be the soul+facts editor; that content now lives in soul.
  if (v === "memory") return "memory";
  return (TABS.some((t) => t.id === v) ? v : "prompts") as Tab;
}

// Library: the reference-editors collapsed into one rail view (IA-1, N2).
// The editors are reused untouched; only the shell around them is new.
export default function Library() {
  const [tab, setTabState] = useState<Tab>(lsTab);
  function setTab(t: Tab) { localStorage.setItem("harness_library_tab", t); setTabState(t); }
  return (
    <div className="library">
      {/* N4: crumb above the tabs — the tabs themselves ARE the second level */}
      <div className="crumb">Library / <b>{TABS.find((t) => t.id === tab)?.label}</b></div>
      <div className="library-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "lib-tab active" : "lib-tab"}
            onClick={() => setTab(t.id)}>{t.icon} {t.label}</button>
        ))}
      </div>
      <div className="library-body">
        {tab === "prompts" && <Prompts />}
        {tab === "skills" && <Skills />}
        {tab === "soul" && <Soul />}
        {tab === "facts" && <Facts />}
        {tab === "memory" && <AutoMemory />}
        {tab === "projects" && <Projects />}
      </div>
    </div>
  );
}
