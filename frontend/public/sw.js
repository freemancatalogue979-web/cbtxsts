/*
 * Absolute Genesis service worker — keeps the app shell on the phone.
 *
 * Why: on a flaky or expensive connection the arena should open instantly and
 * an exam in progress must reopen with no network at all (answers themselves
 * are kept by src/lib/examSync.ts in localStorage; this file keeps the code).
 *
 * Strategy
 * - Page loads (navigations): network first, but give up after a few seconds
 *   and serve the saved shell, so a weak 3G signal never means a white screen.
 * - /assets/* (hashed Vite output): every chunk of this build is saved when the
 *   app is first installed, so opening any screen is instant and only live data
 *   comes from the network. Any chunk missed is cached on first use.
 * - Icons, fonts, the manifest: cache, refreshed in the background.
 * - Never touched: /api, /ws, /live (always live data) and /music (large audio
 *   streamed with Range requests).
 *
 * The build stamps BUILD and APP_ASSETS into this file (see vite.config.ts), so
 * every deploy installs a fresh worker and the previous build's caches are
 * deleted as soon as the new one takes over.
 */
const BUILD = '__SW_BUILD__';
/* Registered as /sw.js?mode=dev by the Vite dev server (start-arena): it only
   makes the app installable and gives an offline fallback page; it never
   caches dev modules, so hot reload behaves exactly as before. */
const DEV = new URL(self.location.href).searchParams.get('mode') === 'dev';
/* Every chunk this build ships (filled in at build time; empty in dev). */
const BUILD_ASSETS = '__SW_ASSETS__';
const APP_ASSETS = Array.isArray(BUILD_ASSETS) ? BUILD_ASSETS : [];
const SHELL = `arena-shell-${BUILD}`;
const ASSETS = `arena-assets-${BUILD}`;
const STATIC = `arena-static-${BUILD}`;
const KEEP = [SHELL, ASSETS, STATIC];
const SHELL_URL = '/index.html';
const NAV_TIMEOUT_MS = 4000;
/* Vite marks module scripts `crossorigin`, so the page sends an Origin header
   while our precache did not; servers answer with `Vary: Origin`, which would
   make every lookup miss offline. Hashed files are identical either way. */
const MATCH = {ignoreVary: true};

const STATIC_PRECACHE = [
  '/manifest.webmanifest',
  '/brand/ag-icon-192.png',
  '/brand/ag-icon-512.png',
  '/brand/ag-icon-maskable-512.png',
  '/brand/ag-apple-touch-180.png',
  '/brand/ag-logo-96.png',
  '/brand/ag-sigil.svg',
  '/brand/absolute-genesis-mini.svg',
  '/brand/absolute-genesis-crown-emblem.png',
  '/arena/world.webp',
  '/arena/world-960.webp',
  '/fonts/familjen-grotesk-latin-400-italic.woff2',
  '/fonts/familjen-grotesk-latin-ext-400-italic.woff2',
];

/** Pull /assets/... URLs out of the built index.html so the shell works offline from visit one. */
function assetsIn(html) {
  const found = new Set();
  const re = /(?:src|href)="(\/assets\/[^"]+)"/g;
  let match;
  while ((match = re.exec(html))) found.add(match[1]);
  return [...found];
}

/** Fetch with a small concurrency limit so a first visit does not open 80 connections at once. */
async function pool(items, size, work) {
  let next = 0;
  const lanes = Array.from({length: Math.min(size, items.length)}, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  });
  await Promise.all(lanes);
}

async function precacheShell() {
  const response = await fetch('/', {cache: 'no-store'});
  if (!response.ok) return;
  const html = await response.clone().text();
  const shell = await caches.open(SHELL);
  await shell.put(SHELL_URL, response);
  const assets = await caches.open(ASSETS);
  const wanted = [...new Set([...assetsIn(html), ...APP_ASSETS])];
  await pool(wanted, 6, (url) => assets.match(url, MATCH).then((hit) => hit || assets.add(url).catch(() => undefined)));
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
  if (DEV) return network.catch(() => cached);
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
  } else if (DEV) {
    return; // dev modules (/src, /@vite, /node_modules) always come from Vite
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
