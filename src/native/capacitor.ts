/**
 * Capacitor native-platform integration.
 *
 * On the web this is inert: `Capacitor.isNativePlatform()` is false, so
 * `initNative()` returns immediately and no native plugins are loaded. The
 * plugin imports are dynamic so they only cost bytes inside the native app.
 */
import { Capacitor } from "@capacitor/core";

/** True when running inside the Capacitor native shell (Android / iOS). */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Wires up native-only behaviour. Safe to call unconditionally — it no-ops on
 * the web build.
 *
 * Currently: map the Android hardware back button onto in-app history so it
 * navigates back through the app's own views (and exits from the root) instead
 * of tearing the WebView down on the first press.
 */
export async function initNative(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("backButton", ({ canGoBack }) => {
      // `canGoBack` is the WebView's authoritative signal and already accounts
      // for the SPA's pushState entries. Do NOT also gate on
      // `window.history.length`: that is the total session-entry count, which
      // never decreases as the user navigates back, so it would stay > 1 forever
      // after the first search and route every root-level back press into a
      // no-op history.back() — trapping the user, who could never exit.
      if (canGoBack) {
        window.history.back();
      } else {
        void App.exitApp();
      }
    });
  } catch {
    // Plugin missing / not synced — degrade gracefully to default WebView behaviour.
  }
}
