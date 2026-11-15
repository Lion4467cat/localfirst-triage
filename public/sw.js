const CACHE_NAME = "localfirst-triage-shell-v2";
const BASE_ASSETS = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(BASE_ASSETS);
      try {
        const res = await fetch("/index.html", { cache: "no-store" });
        if (res.ok) {
          const html = await res.text();
          const assetMatches = html.match(/\/assets\/[^"'\s>]+/g) ?? [];
          if (assetMatches.length > 0) {
            await cache.addAll([...new Set(assetMatches)]);
          }
        }
      } catch {
        // Ignore if offline during install
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && (url.pathname.startsWith("/assets/") || url.pathname === "/")) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match("/index.html"));
    }),
  );
});
