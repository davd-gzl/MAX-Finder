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

  // When a NEW service worker replaces an existing one, reload once so the page
  // swaps to the freshly deployed assets. This is the recovery path for a client
  // pinned to a stale shell/bundle (the "white page" failure mode): the new SW
  // skipWaiting()s, claims the client, controllerchange fires, we reload.
  // Guard on a pre-existing controller so a brand-new visit (initial claim, no
  // stale state) doesn't reload gratuitously.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    // updateViaCache:"none" forces the browser to bypass its HTTP cache when
    // checking sw.js for updates, so a new SW version is always picked up.
    navigator.serviceWorker
      .register(swUrl, { updateViaCache: "none" })
      .then((reg) => {
        // Proactively check for an updated SW on every load.
        reg.update().catch(() => {});
      })
      .catch(() => {
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
