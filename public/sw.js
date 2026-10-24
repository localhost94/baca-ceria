// Service worker: simpan file aplikasi supaya cepat dibuka & bisa di-install sebagai PWA.
// Strategi network-first: selalu ambil versi terbaru kalau online, pakai cache kalau offline.
// /api/* tidak disentuh (data pemain & audio tts sudah di-cache HTTP oleh browser).
const CACHE = "baca-ceria-v1";
const SHELL = [
  "/", "/index.html", "/style.css", "/app.js", "/fx.js", "/data.js", "/lex.js",
  "/vendor/pixi.min.js", "/favicon.svg", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) =>
        hit || (e.request.mode === "navigate" ? caches.match("/") : Response.error()))),
  );
});
