import React from "react";
import { createRoot } from "react-dom/client";
import { loadPrefs } from "./lib/prefs";
import "./styles.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

(async () => {
  await loadPrefs();
  // dynamic import: the store reads localStorage at module init,
  // so App must be imported only AFTER prefs are hydrated
  const { default: App } = await import("./App");
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
})();
