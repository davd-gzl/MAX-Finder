/**
 * White-page guard. A classic (non-module) script, loaded independently of the
 * app bundle, so it still runs when the bundle itself fails to load/execute —
 * the exact situation that produces a blank page (a stale cached shell whose
 * hashed bundle 404'd, a transient asset fetch failure, a top-level crash).
 *
 * If the bundle never ran a few seconds after parse, it wipes the service worker
 * and all caches and hard-reloads once (network-first navigation then fetches a
 * fresh index.html with the current asset hashes). Throttled to once a minute so
 * a genuinely broken deploy can't loop — but those are caught by the CI render
 * gate before they ship, so in practice this only ever heals stale-cache blanks.
 */
(function () {
  var KEY = "mf-healed-at";

  function bundleRan() {
    return window.__mfBoot === true;
  }

  function heal() {
    var last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60000) return; // at most once a minute — never loop
    sessionStorage.setItem(KEY, String(Date.now()));
    var reload = function () {
      location.reload();
    };
    var jobs = [];
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        jobs.push(
          navigator.serviceWorker.getRegistrations().then(function (rs) {
            return Promise.all(
              rs.map(function (r) {
                return r.unregister();
              })
            );
          })
        );
      }
      if (window.caches && caches.keys) {
        jobs.push(
          caches.keys().then(function (ks) {
            return Promise.all(
              ks.map(function (k) {
                return caches.delete(k);
              })
            );
          })
        );
      }
    } catch (e) {
      /* ignore */
    }
    var settle = jobs.length
      ? Promise.all(
          jobs.map(function (p) {
            return p.catch(function () {});
          })
        )
      : Promise.resolve();
    settle.then(reload, reload);
  }

  setTimeout(function () {
    if (!bundleRan()) heal();
  }, 5000);
})();
