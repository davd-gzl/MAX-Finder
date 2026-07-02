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
      if (canGoBack || window.history.length > 1) {
        window.history.back();
      } else {
        void App.exitApp();
      }
    });
  } catch {
    // Plugin missing / not synced — degrade gracefully to default WebView behaviour.
  }
}
