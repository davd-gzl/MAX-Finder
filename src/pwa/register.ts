/**
 * PWA helpers: service worker registration and Notifications API wrappers.
 * Dependency-free, strict-TS-clean.
 */

// ---------------------------------------------------------------------------
// Service Worker registration
// ---------------------------------------------------------------------------

/**
 * Registers the service worker in production only.
 * The SW is placed at public/sw.js which Vite copies verbatim to the build
 * output at BASE_URL/sw.js, giving it scope BASE_URL (e.g. /MAX-Finder/).
 *
 * Call this once from main.ts, e.g.:
 *   import { registerServiceWorker } from "./pwa/register";
 *   registerServiceWorker();
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl).catch(() => {
      // Fail silently — the app works without a SW.
    });
  });
}

// ---------------------------------------------------------------------------
// Notifications API helpers
// ---------------------------------------------------------------------------

/**
 * Requests notification permission from the user.
 * Returns "denied" if the Notifications API is unavailable.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return Notification.requestPermission();
}

/**
 * Fires a notification if permission is already granted.
 * Silently does nothing if unsupported or permission not granted.
 *
 * @param title - Notification title
 * @param body  - Notification body text
 */
export function notify(title: string, body: string): void {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: `${import.meta.env.BASE_URL}icons/icon.svg` });
  } catch {
    // Some environments (e.g. iOS Safari) throw on direct Notification construction.
    // Callers using watched-route alerts can upgrade to SW push notifications later.
  }
}
