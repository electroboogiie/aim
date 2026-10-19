// Service worker: app shell cache-first (refreshed in the background), /api network-first with the last
// answer as the offline fallback, thumbnails cache-first. Bump VERSION to drop every cache on the next visit.
const VERSION = "kp-2026-10-18-1";
const SHELL_CACHE = `${VERSION}-shell`;
const API_CACHE = `${VERSION}-api`;
const MEDIA_CACHE = `${VERSION}-media`;

// Every file the page needs offline (scripts/web-smoke.mjs checks this list against web/dist).
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-192.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "js/core/src/catalog.js",
  "js/core/src/format.js",
  "js/core/src/index.js",
  "js/core/src/pricing.js",
  "js/core/src/spec.js",
  "js/web/src/api.js",
  "js/web/src/app.js",
  "js/web/src/demo.js",
  "js/web/src/dom.js",
  "js/web/src/draft.js",
  "js/web/src/labels.js",
  "js/web/src/main.js",
  "js/web/src/router.js",
  "js/web/src/storage.js",
  "js/web/src/ui.js",
  "js/web/src/views/configurator.js",
  "js/web/src/views/journal.js",
  "js/web/src/views/settings.js",
  "js/web/src/views/token.js",
  /* demo-shell */
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((p) => new Request(p, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION + "-")).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const scopePath = new URL(self.registration.scope).pathname;

function offlineJson() {
  return new Response(JSON.stringify({ error: "Немає з’єднання з сервером." }), {
    status: 503,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-KP-Offline": "1" },
  });
}

async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok && !request.url.includes("/file/")) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request);
    return hit || offlineJson();
  }
}

async function cacheFirst(request, cacheName, event) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: cacheName === SHELL_CACHE });
  const refresh = fetch(request).then((res) => {
    if (res.ok && res.type === "basic") cache.put(request, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(refresh.catch(() => undefined));
    return hit;
  }
  try {
    return await refresh;
  } catch {
    if (request.mode === "navigate") {
      const shell = await cache.match("index.html");
      if (shell) return shell;
    }
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname.startsWith(scopePath) ? url.pathname.slice(scopePath.length) : url.pathname.replace(/^\//, "");
  if (path.startsWith("api/")) {
    if (path.includes("/file/")) return;           // downloads go straight to the network
    event.respondWith(networkFirst(req));
    return;
  }
  if (path.startsWith("media/")) {
    event.respondWith(cacheFirst(req, MEDIA_CACHE, event));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(cacheFirst(new Request("index.html"), SHELL_CACHE, event));
    return;
  }
  event.respondWith(cacheFirst(req, SHELL_CACHE, event));
});
