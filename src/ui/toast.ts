// A small "postcard" — a dismissible bottom banner with one action, used for
// non-blocking nudges (a low-end-device suggestion, a "new version available"
// prompt). One at a time: a new postcard replaces any current one.

import { el } from "./dom";
import { t } from "../i18n";

let current: HTMLElement | null = null;

function dismiss(): void {
  if (current) {
    current.remove();
    current = null;
  }
}

/**
 * Show a bottom postcard with a title, a message, one primary action and a close
 * button. Both the action and the close remove the card; the action then runs its
 * handler. Replaces any card already showing.
 */
export function showPostcard(opts: {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss?: () => void;
}): void {
  dismiss();
  const close = (run?: () => void): void => {
    dismiss();
    run?.();
  };
  const card = el("div", { class: "postcard", attrs: { role: "status", "aria-live": "polite" } }, [
    el("div", { class: "postcard-text" }, [
      el("p", { class: "postcard-title", text: opts.title }),
      el("p", { class: "postcard-msg muted small", text: opts.message }),
    ]),
    el("div", { class: "postcard-actions" }, [
      el("button", {
        class: "btn btn-primary postcard-act",
        type: "button",
        text: opts.actionLabel,
        on: { click: () => close(opts.onAction) },
      }),
      el("button", {
        class: "postcard-x",
        type: "button",
        text: "✕",
        attrs: { "aria-label": t("act_close") },
        on: { click: () => close(opts.onDismiss) },
      }),
    ]),
  ]);
  current = card;
  document.body.append(card);
}
