// Service worker of the KP configurator (PWA): the app opens without a connection to the PC with the last
// catalog and settings, photos and opened PDFs are kept; KPs are still made on the PC.
const VER = "kp-2026-10-25";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "vendor/qrcode.js",
  "core/index.js", "core/catalog.js", "core/format.js", "core/pricing.js", "core/spec.js", "core/types.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"];
const SHELL_C = VER + "-shell", DATA_C = "kp-data", IMG_C = "kp-img", PDF_C = "kp-pdf";
const LIMIT = { [IMG_C]: 400, [PDF_C]: 30 };

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_C).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.endsWith("-shell") && k !== SHELL_C).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(name) {
  const c = await caches.open(name), keys = await c.keys(), max = LIMIT[name];
  for (let i = 0; max && i < keys.length - max; i++) await c.delete(keys[i]);
}
/** The PC answers first (prices and code are always current); the saved copy only when it can't be reached. */
async function networkFirst(req, name) {
  try {
    const r = await fetch(req);
    if (r.ok) { const c = await caches.open(name); await c.put(req, r.clone()); if (LIMIT[name]) trim(name); }
    return r;
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: name === SHELL_C });
    if (hit && name === DATA_C) {   // the app shows «Немає зв’язку з ПК»: these are the last saved data
      const hd = new Headers(hit.headers); hd.set("X-Kp-Offline", "1");
      return new Response(await hit.blob(), { status: 200, headers: hd });
    }
    if (hit) return hit;
    if (req.mode === "navigate") { const idx = await caches.match("index.html"); if (idx) return idx; }
    throw err;
  }
}
async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) { const c = await caches.open(name); await c.put(req, r.clone()); trim(name); }
  return r;
}

self.addEventListener("fetch", (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== location.origin) return;
  const p = u.pathname;
  if (p === "/api/bootstrap" || p === "/api/history") return e.respondWith(networkFirst(req, DATA_C));
  if (p.startsWith("/assets/")) return e.respondWith(cacheFirst(req, IMG_C));
  if (p.startsWith("/api/preview/") || p === "/api/bg") return e.respondWith(networkFirst(req, IMG_C));
  if (p.startsWith("/out/") && p.endsWith(".pdf")) return e.respondWith(networkFirst(req, PDF_C));
  if (p.startsWith("/vendor/pdfjs/")) return e.respondWith(cacheFirst(req, SHELL_C));
  if (p.startsWith("/api/") || p.startsWith("/out/") || p.startsWith("/pages/")) return;   // live answers of the PC only
  e.respondWith(networkFirst(req, SHELL_C));
});
