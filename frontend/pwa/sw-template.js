/* 9 Clover service worker — generated at build time by the `cloverPwa` Vite
 * plugin (vite.config.ts), which replaces the two placeholders below with the
 * build version and the exact list of hashed files in this build.
 *
 * Rules:
 *  - Private data is never cached: /api, /live and /ws always go to the network.
 *  - The app shell (index.html, JS, CSS, fonts, icons) is precached, so the
 *    installed app opens instantly and still opens with no signal.
 *  - Page loads try the network first (fresh deploys show up straight away)
 *    and fall back to the cached shell after a short timeout or when offline.
 *  - Hero art, maps and brand images are served from cache and refreshed in
 *    the background.
 *  - A new version waits until the member taps "Reload" (no surprise reloads
 *    mid-draft); old caches, including any from earlier apps on this origin,
 *    are deleted when the new version takes over.
 */
const VERSION = "__CLOVER_VERSION__";
const PRECACHE = __CLOVER_PRECACHE__;

const SHELL = `clover-shell-${VERSION}`;
const MEDIA = "clover-media-v1";
const KEEP = new Set([SHELL, MEDIA]);
const MEDIA_LIMIT = 400;
const NAV_TIMEOUT_MS = 3500;
const PRIVATE = /^\/(api|live|ws)(\/|$)/;
const MEDIA_PATHS = /^\/(heroes|map|map-chips|brand)\//;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (!KEEP.has(name)) await caches.delete(name);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Rone art, YouTube, etc.
  if (PRIVATE.test(url.pathname)) return; // never cache member data
  if (request.headers.get("accept")?.includes("text/event-stream")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigation(event));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (MEDIA_PATHS.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});

async function navigation(event) {
  const shell = await caches.open(SHELL);
  const network = (async () => {
    const preloaded = await event.preloadResponse;
    const response = preloaded || await fetch(event.request);
    if (response.ok) await shell.put("/index.html", response.clone());
    return response;
  })();
  const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS, null));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
  } catch {
    // offline: fall through to the cached shell
  }
  const cached = await shell.match("/index.html");
  if (cached) {
    network.catch(() => {}); // let a slow response still refresh the cache
    return cached;
  }
  return network;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(SHELL)).put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(MEDIA);
  const cached = await cache.match(request) || await caches.match(request);
  const refresh = fetch(request).then(async (response) => {
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
      await trim(cache);
    }
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MEDIA_LIMIT; i += 1) await cache.delete(keys[i]);
}
