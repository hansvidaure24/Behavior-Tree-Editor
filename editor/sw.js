// ponytail: bump CACHE_VERSION on deploy; automate with `sed -i` in deploy script if needed
const CACHE_VERSION = 95;
const CACHE = `bt-editor-v${CACHE_VERSION}`;
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./nodes.js",
  "./serialization.js",
  "./history.js",
  "./replay.js",
  "./canvas.js",
  "./properties.js",
  "./fuse.min.js",
  "./ai-gen.js",
  "./validation.js",
  "./context-menus.js",
  "./exports.js",
  "./storage.js",
  "./app.js",
  "./examples.json",
  "./favicon.ico",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
    if (resp.ok) { const clone = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); }
    return resp;
  })));
});
