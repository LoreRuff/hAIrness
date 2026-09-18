// Browser notifications, best-effort only: the in-app toast always fires,
// this is the extra channel for runs that pause/finish while the tab is
// hidden. Permission is requested once at app boot (App.tsx); here we just
// no-op when denied or unsupported (non-secure contexts, old browsers).
export function notify(title: string, body: string): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icon.svg" });
    }
  } catch { /* notifications must never break a run */ }
}

// Called once per page load: "default" means the user never answered, so
// asking again is polite. Once granted/denied the browser stores it.
export function requestNotificationPermission(): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch { /* unsupported: in-app toast still works */ }
}
