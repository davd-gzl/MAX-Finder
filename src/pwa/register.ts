/**
 * PWA helpers: service worker registration and Notifications API wrappers.
 * Strict-TS-clean.
 */

import { isNativePlatform } from "../native/capacitor";

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
export function registerServiceWorker(onUpdateReady?: () => void): void {
  if (!import.meta.env.PROD) return;
  // Inside the Capacitor native shell the app is served from the bundle, not a
  // web origin — a service worker would only add a stale-cache layer over local
  // assets. Skip it; the native app updates via the store, not the SW.
  if (isNativePlatform()) return;
  if (!("serviceWorker" in navigator)) return;

  // A NEW service worker has taken over (it skipWaiting()s on install, so
  // controllerchange fires as soon as the freshly deployed build is ready). Rather
  // than reload out from under the user, hand off to `onUpdateReady` so the app can
  // show a "new version — reload" postcard; the user reloads on their own terms.
  // Fall back to an immediate reload if no handler was given. Guard on a pre-existing
  // controller so a brand-new visit (initial claim, no stale state) doesn't fire.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let announced = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || announced) return;
    announced = true;
    if (onUpdateReady) onUpdateReady();
    else window.location.reload();
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
