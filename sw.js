// Offline support: serve from cache first, refresh in the background, so the app opens instantly
// and a new version shows on the next open.
const CACHE = "mecee-9a4fce2b1b";
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
// tapping a reminder opens (or focuses) the app
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(cs => {
    const c = cs.find(x => x.url.startsWith(self.registration.scope));
    return c ? c.focus() : self.clients.openWindow("./");
  }));
});
// reminders sent by the reminder server arrive here, even when the app is closed
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {body: e.data && e.data.text()}; }
  e.waitUntil(self.registration.showNotification(d.title || "MECEE-BL", {
    body: d.body || "", tag: d.tag || "mecee", renotify: true, icon: "icons/icon-192.png", badge: "icons/icon-192.png", vibrate: [180, 80, 180], data: {url: "./"}
  }));
});
