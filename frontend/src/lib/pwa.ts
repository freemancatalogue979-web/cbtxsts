/**
 * Installable app + offline shell (see public/sw.js and public/manifest.webmanifest).
 *
 * - registerServiceWorker(): production builds only. The dev server keeps
 *   hot reload and never gets a stale cached shell.
 * - useInstallPrompt(): Chrome/Android fires `beforeinstallprompt`; we keep it
 *   so a real button ("Install app") can open the native prompt later.
 *   iPhones have no prompt; `iosHint` is true there so the UI can say
 *   "Share → Add to Home Screen" instead.
 */
import {useEffect, useState} from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & {standalone?: boolean}).standalone === true
  );
}

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        // Chunks fetched before the worker took over: ask it to keep them too.
        const urls = performance
          .getEntriesByType('resource')
          .map((entry) => new URL(entry.name, location.href))
          .filter((url) => url.origin === location.origin && url.pathname.startsWith('/assets/'))
          .map((url) => url.pathname);
        registration.active?.postMessage({type: 'arena:cache-assets', urls});
      })
      .catch(() => undefined);
  });
}

export function useInstallPrompt(): {canInstall: boolean; iosHint: boolean; installed: boolean; install: () => Promise<boolean>} {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const installed = isStandalone();
  const ios = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  return {
    canInstall: !installed && deferred !== null,
    iosHint: !installed && ios,
    installed,
    install: async () => {
      const event = deferred;
      if (!event) return false;
      await event.prompt();
      const choice = await event.userChoice.catch(() => ({outcome: 'dismissed' as const}));
      deferred = null;
      notify();
      return choice.outcome === 'accepted';
    },
  };
}
