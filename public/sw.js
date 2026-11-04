/* HackerTube service worker: app shell precache, runtime data cache, offline fallback. */
const VERSION = "v1";
const SHELL_CACHE = `ht-shell-${VERSION}`;
const DATA_CACHE = `ht-data-${VERSION}`;
const SCOPE = new URL("./", self.location.href).href;
const INDEX = new URL("index.html", SCOPE).href;

const PRECACHE = [
  SCOPE,
  INDEX,
  new URL("styles.css", SCOPE).href,
  new URL("app.js", SCOPE).href,
  new URL("i18n.js", SCOPE).href,
  new URL("search.js", SCOPE).href,
  new URL("i18n/en.json", SCOPE).href,
  new URL("i18n/ar.json", SCOPE).href,
  new URL("manifest.webmanifest", SCOPE).href,
  new URL("icons/icon.svg", SCOPE).href,
  new URL("icons/icon-192.png", SCOPE).href,
  new URL("icons/icon-512.png", SCOPE).href,
  new URL("icons/icon-maskable-512.png", SCOPE).href,
  new URL("icons/apple-touch-icon.png", SCOPE).href,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("ht-") && key !== SHELL_CACHE && key !== DATA_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName, fallbackUrl = null) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request))
      || (await cache.match(request, { ignoreSearch: true }))
      || (fallbackUrl ? await cache.match(fallbackUrl) : null)
      || (cacheName === SHELL_CACHE ? await cache.match(INDEX) : null)
      || new Response(cacheName === SHELL_CACHE ? "Offline" : "{}", {
        status: 503,
        headers: { "Content-Type": cacheName === SHELL_CACHE ? "text/html; charset=utf-8" : "application/json" },
      });
  }
}

async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
  const update = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  return (await update) || new Response("", { status: 504 });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, SCOPE));
    return;
  }
  if (url.pathname.includes("/data/")) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }
  if (url.searchParams.has("v")) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }
  if (/\.(?:css|js|json|webmanifest|png|svg|ico)$/.test(url.pathname) || url.pathname.endsWith("/")) {
    event.respondWith(staleWhileRevalidate(event, request, SHELL_CACHE));
    return;
  }
  event.respondWith(networkFirst(request, SHELL_CACHE));
});
