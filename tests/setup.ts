import { beforeEach } from "vitest";

/**
 * Node 26 registers a native `localStorage` global that stays `undefined`
 * unless the runtime is started with `--localstorage-file`, and it shadows the
 * one jsdom would otherwise provide. Install a spec-compliant in-memory Storage
 * whenever the running environment hasn't supplied a working one, so the suite
 * behaves identically on Node 22 (CI) and Node 26 (local).
 */
function installStorage(): void {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

function storageIsUsable(): boolean {
  try {
    return typeof localStorage !== "undefined" && typeof localStorage.clear === "function";
  } catch {
    return false;
  }
}

if (!storageIsUsable()) installStorage();

beforeEach(() => {
  if (!storageIsUsable()) installStorage();
});
