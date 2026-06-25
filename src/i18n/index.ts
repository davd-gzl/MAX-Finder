import { fr, type Dict } from "./fr";
import { en } from "./en";
import { es } from "./es";
import { de } from "./de";
import { it } from "./it";
import { ko } from "./ko";
import { zh } from "./zh";

export type Lang = "fr" | "en" | "es" | "de" | "it" | "ko" | "zh";

const dicts: Record<Lang, Dict> = { fr, en, es, de, it, ko, zh };

/** Supported languages, in display order, with their autonym (native label). */
export const LANGS: ReadonlyArray<{ code: Lang; label: string }> = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "ko", label: "한국어" },
  { code: "zh", label: "中文" },
];

let current: Lang = "fr";

export function isLang(x: unknown): x is Lang {
  return typeof x === "string" && LANGS.some((l) => l.code === x);
}

export function setLang(lang: Lang): void {
  current = lang;
  document.documentElement.lang = lang;
}

export function getLang(): Lang {
  return current;
}

/** Best supported language for the browser, else French. */
export function detectLang(): Lang {
  const code = (navigator.language || "fr").toLowerCase().split("-")[0];
  return isLang(code) ? code : "fr";
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
