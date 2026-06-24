import { fr, type Dict } from "./fr";
import { en } from "./en";

export type Lang = "fr" | "en";

const dicts: Record<Lang, Dict> = { fr, en };
let current: Lang = "fr";

export function setLang(lang: Lang): void {
  current = lang;
  document.documentElement.lang = lang;
}

export function getLang(): Lang {
  return current;
}

export function detectLang(): Lang {
  const nav = (navigator.language || "fr").toLowerCase();
  return nav.startsWith("en") ? "en" : "fr";
}

/** Translate `key`, substituting `{name}` placeholders from `params`. */
export function t(key: keyof Dict, params?: Record<string, string | number>): string {
  let s: string = dicts[current][key] ?? fr[key] ?? String(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}
