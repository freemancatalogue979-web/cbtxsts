/**
 * On-demand screens.
 *
 * The first download only carries what a player needs to land (login, home,
 * the exam engine). Everything else is fetched the first time it opens, then
 * kept by the service worker (public/sw.js), so the second visit is instant
 * and works offline.
 *
 * Two failure modes are handled here instead of crashing into the error page:
 * - a new deploy replaced the hashed chunk: reload once to pick up the new
 *   index.html (guarded so a broken build can't loop);
 * - the phone is offline and the screen was never opened before: explain that
 *   instead of showing a stack trace.
 */
import {lazy, type ComponentType} from 'react';

const RELOAD_KEY = 'arena.chunk-reload';

export class OfflineScreenError extends Error {
  constructor() {
    super("You're offline and this screen hasn't been saved on this phone yet. Reconnect and try again.");
    this.name = 'OfflineScreenError';
  }
}

/**
 * Can we actually reach the site? `navigator.onLine` says true on Wi-Fi with no
 * data or an exhausted bundle, so ask the server (the service worker does not
 * intercept this path, so the answer is real).
 */
async function siteReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`/index.html?probe=${Date.now()}`, {cache: 'no-store', signal: controller.signal});
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

export function lazyScreen<T extends ComponentType<any>>(factory: () => Promise<{default: T}>) {
  return lazy(async () => {
    try {
      const mod = await factory();
      return mod;
    } catch (error) {
      if (!(await siteReachable())) throw new OfflineScreenError();
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
      } catch {
        /* storage blocked: fall through and surface the error */
      }
      if (Date.now() - last > 30_000) {
        try {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        } catch {
          /* ignore */
        }
        window.location.reload();
        // Keep Suspense waiting while the page reloads.
        return new Promise<{default: T}>(() => {});
      }
      throw error;
    }
  });
}

/** True when quietly fetching extra screens would waste the player's data. */
function onTightData(): boolean {
  const conn = (navigator as Navigator & {connection?: {saveData?: boolean; effectiveType?: string}}).connection;
  if (!conn) return false;
  return conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || '');
}

/**
 * Warm the screens most players open next, once the app is idle. The service
 * worker keeps them, so they also open offline later. Skipped on Data Saver
 * and 2G, where every kilobyte is the player's money.
 */
export function prefetchWhenIdle(loaders: Array<() => Promise<unknown>>, delayMs = 5000): void {
  if (typeof window === 'undefined' || onTightData()) return;
  const run = () => {
    let index = 0;
    const next = () => {
      if (index >= loaders.length || navigator.onLine === false) return;
      const load = loaders[index++];
      load()
        .catch(() => undefined)
        .finally(() => {
          const idle = (window as Window & {requestIdleCallback?: (cb: () => void) => number}).requestIdleCallback;
          if (idle) idle(next);
          else setTimeout(next, 200);
        });
    };
    next();
  };
  window.setTimeout(run, delayMs);
}
