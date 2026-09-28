/*
 * Quiz Arena service worker — keeps the app shell on the phone.
 *
 * Why: on a flaky or expensive connection the arena should open instantly and
 * an exam in progress must reopen with no network at all (answers themselves
 * are kept by src/lib/examSync.ts in localStorage; this file keeps the code).
 *
 * Strategy
 * - Page loads (navigations): network first, but give up after a few seconds
 *   and serve the saved shell, so a weak 3G signal never means a white screen.
 * - /assets/* (hashed Vite output, never changes under the same name): cache
 *   first. Chunks are saved the first time any screen downloads them.
 * - Icons, fonts, the manifest: cache, refreshed in the background.
 * - Never touched: /api, /ws, /live (always live data) and /music (large audio
 *   streamed with Range requests).
 *
 * Bump VERSION to drop every old cache on the next visit.
 */
const VERSION = 'v2';
const SHELL = `arena-shell-${VERSION}`;
const ASSETS = `arena-assets-${VERSION}`;
const STATIC = `arena-static-${VERSION}`;
const KEEP = [SHELL, ASSETS, STATIC];
const SHELL_URL = '/index.html';
const NAV_TIMEOUT_MS = 4000;
const MAX_ASSETS = 160;
/* Vite marks module scripts `crossorigin`, so the page sends an Origin header
   while our precache did not; servers answer with `Vary: Origin`, which would
   make every lookup miss offline. Hashed files are identical either way. */
const MATCH = {ignoreVary: true};

const STATIC_PRECACHE = ['/manifest.webmanifest', '/brand/icon-192.png', '/brand/logo-96.png'];

/** Pull /assets/... URLs out of the built index.html so the shell works offline from visit one. */
function assetsIn(html) {
  const found = new Set();
  const re = /(?:src|href)="(\/assets\/[^"]+)"/g;
  let match;
  while ((match = re.exec(html))) found.add(match[1]);
  return [...found];
}

async function precacheShell() {
  const response = await fetch('/', {cache: 'no-store'});
  if (!response.ok) return;
  const html = await response.clone().text();
  const shell = await caches.open(SHELL);
  await shell.put(SHELL_URL, response);
  const assets = await caches.open(ASSETS);
  await Promise.all(assetsIn(html).map((url) => assets.add(url).catch(() => undefined)));
  const statics = await caches.open(STATIC);
  await Promise.all(STATIC_PRECACHE.map((url) => statics.add(url).catch(() => undefined)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith('arena-') && !KEEP.includes(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** Keep the asset cache bounded (old deploys' chunks fall out first). */
async function trimAssets() {
  const cache = await caches.open(ASSETS);
  const keys = await cache.keys();
  const extra = keys.length - MAX_ASSETS;
  for (let i = 0; i < extra; i += 1) await cache.delete(keys[i]);
}

async function handleNavigation(request) {
  const shell = await caches.open(SHELL);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
        await shell.put(SHELL_URL, response.clone());
      }
      return response;
    });
  const cached = await shell.match(SHELL_URL, MATCH);
  if (!cached) return network;
  // Slow network: answer from the saved shell, let the fetch finish in the background.
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  try {
    const winner = await Promise.race([network, timeout]);
    if (winner) return winner;
    network.catch(() => undefined);
    return cached;
  } catch {
    return cached;
  }
}

async function handleAsset(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request, MATCH);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trimAssets().catch(() => undefined);
  }
  return response;
}

async function handleStatic(request, event) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request, MATCH);
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return (await refresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const {request} = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith('/api') || path.startsWith('/ws') || path.startsWith('/live') || path.startsWith('/music')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
  } else if (path.startsWith('/assets/')) {
    event.respondWith(handleAsset(request));
  } else if (/^\/(brand|fonts|arena)\//.test(path) || path === '/manifest.webmanifest') {
    event.respondWith(handleStatic(request, event));
  }
});

/* The page reports chunks it loaded before this worker took control. */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'arena:cache-assets' && Array.isArray(data.urls)) {
    event.waitUntil(
      caches.open(ASSETS).then((cache) =>
        Promise.all(
          data.urls
            .filter((url) => typeof url === 'string' && url.startsWith('/assets/'))
            .slice(0, 80)
            .map((url) => cache.match(url, MATCH).then((hit) => hit || cache.add(url).catch(() => undefined))),
        ),
      ),
    );
  }
});
