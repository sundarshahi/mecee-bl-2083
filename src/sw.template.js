// Offline support: serve from cache first, refresh in the background, so the app opens instantly
// and a new version shows on the next open.
const CACHE = "mecee-__VER__";
const CORE = ["./", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const url = new URL(r.url);
  const own = url.origin === self.location.origin, font = /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!own && !font) return;
  const key = r.mode === "navigate" ? "./" : r;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(key);
    const net = fetch(r).then(res => { if (res.ok || res.type === "opaque") c.put(key, res.clone()); return res; }).catch(() => hit || Response.error());
    return hit || net;
  }));
});
