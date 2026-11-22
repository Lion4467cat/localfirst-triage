const CACHE_NAME = "localfirst-triage-shell-v4.2.0";
const BASE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/theme-init.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const IS_LOCALHOST =
  self.location.hostname === "127.0.0.1" || self.location.hostname === "localhost";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      if (!IS_LOCALHOST) {
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
        Promise.all(
          keys
            .filter((k) => IS_LOCALHOST || k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (IS_LOCALHOST) return;

  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isHtmlNavigation =
    request.mode === "navigate" || url.pathname === "/" || url.pathname === "/index.html";

  if (isHtmlNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/index.html"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const contentType = response.headers.get("content-type") || "";
          const isStaticAsset =
            url.pathname.startsWith("/assets/") ||
            url.pathname.startsWith("/icons/") ||
            url.pathname === "/theme-init.js";

          if (response.ok && isStaticAsset && !contentType.includes("text/html")) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => Response.error());
    }),
  );
});
