import React from "react";
import { createRoot } from "react-dom/client";
import { loadPrefs } from "./lib/prefs";
import { applyAccent, currentMode } from "./lib/palette";
import "./styles.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

(async () => {
  await loadPrefs();
  // Theme may have been updated by the prefs sync: re-apply before render
  // (index.html already set it from localStorage, without the server value).
  document.documentElement.dataset.theme = localStorage.getItem("harness_theme") || "dark";
  // Accent is applied post-paint only: generating it pre-paint would mean
  // duplicating the WCAG contrast logic inline in index.html. A brief default
  // accent on first paint is the accepted tradeoff.
  applyAccent(localStorage.getItem("harness_accent"), currentMode());
  // dynamic import: the store reads localStorage at module init,
  // so App must be imported only AFTER prefs are hydrated
  const { default: App } = await import("./App");
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
})();
