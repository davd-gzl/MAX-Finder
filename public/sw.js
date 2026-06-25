/**
 * Service Worker for MAX Finder PWA
 *
 * Scope: /MAX-Finder/ (registered from that sub-path)
 *
 * Strategies:
 *  - Navigation requests  → network-first, fallback to cached shell
 *  - /data/*.json         → network-first, fallback to cache
 *  - Same-origin GET      → cache-first (hashed JS/CSS assets)
 *  - Cross-origin / POST  → passthrough, never cached
 */

const CACHE_NAME = "maxjeune-v2";

// Minimal app shell — paths relative to the SW's scope (/MAX-Finder/)
// Vite injects a hashed index.html in the build output at the base path.
// We store the scope root ("/MAX-Finder/") as the shell fallback URL.
const SHELL_URL = self.registration.scope; // e.g. "https://host/MAX-Finder/"

// ---------------------------------------------------------------------------
// Install — precache the app shell
// ---------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(SHELL_URL))
      .then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// Activate — delete stale caches, claim clients
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET; let POST/PUT/etc pass through unchanged.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);

  // Never intercept cross-origin requests (SNCF API, map tiles, etc.)
  if (url.origin !== scope.origin) return;

  const isSameOrigin = url.origin === scope.origin;

  if (!isSameOrigin) return; // redundant safety check

  // ----- Navigation requests: network-first → shell fallback ---------------
  if (request.mode === "navigate") {
    event.respondWith(networkFirstWithShellFallback(request));
    return;
  }

  // ----- /data/*.json: network-first → cache fallback ----------------------
  if (url.pathname.startsWith(scope.pathname + "data/") && url.pathname.endsWith(".json")) {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  // ----- Other same-origin GET (JS/CSS/fonts/images): cache-first ----------
  event.respondWith(cacheFirstThenNetwork(request));
});

// ---------------------------------------------------------------------------
// Strategy helpers
// ---------------------------------------------------------------------------

/**
 * Network-first. On failure, return cached shell.
 */
async function networkFirstWithShellFallback(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Last resort: serve the shell index
    const shell = await cache.match(SHELL_URL);
    return shell ?? new Response("Offline", { status: 503 });
  }
}

/**
 * Network-first. On failure, fall back to whatever is in the cache.
 */
async function networkFirstWithCacheFallback(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    return cached ?? new Response("Offline", { status: 503 });
  }
}

/**
 * Cache-first. On cache miss, fetch from network and populate cache.
 */
async function cacheFirstThenNetwork(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}
