// Vitest global setup.
//
// Under jsdom 25 (as resolved here) `globalThis.localStorage` is a bare object
// with no Storage methods, so any test that calls `localStorage.clear()` /
// `getItem` / `setItem` throws. Install a minimal in-memory Storage shim when a
// working one isn't present, and reset it before each test for isolation.

import { beforeEach } from "vitest";

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
  } as Storage;
}

function ensureStorage(name: "localStorage" | "sessionStorage"): void {
  const existing = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
  if (existing && typeof existing.clear === "function") return;
  Object.defineProperty(globalThis, name, {
    value: makeStorage(),
    configurable: true,
    writable: true,
  });
}

ensureStorage("localStorage");
ensureStorage("sessionStorage");

beforeEach(() => {
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
});
