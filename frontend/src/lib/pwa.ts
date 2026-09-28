/**
 * Installable app + offline shell (see public/sw.js and public/manifest.webmanifest).
 *
 * - registerServiceWorker(): production builds cache the app shell. The dev
 *   server registers the same worker in "dev" mode (no asset caching, so hot
 *   reload is untouched) purely so `npx vite` / start-arena is installable too.
 * - useInstallPrompt(): Chrome, Edge, Samsung Internet and Opera (Android and
 *   desktop) fire `beforeinstallprompt`; we keep it so our own "Install app"
 *   buttons open the native prompt. Where there is no prompt (iPhone Safari,
 *   Firefox, a plain-http link) the buttons open step-by-step help instead.
 */
import {useEffect, useState} from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
}

let deferred: InstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches === true ||
    (navigator as Navigator & {standalone?: boolean}).standalone === true
  );
}

/** Which instructions to show when there is no native install prompt. */
export type InstallPlatform =
  | 'insecure' // http:// on a network address: no browser allows installing
  | 'ios-safari'
  | 'ios-other' // Chrome/Firefox/Edge on iPhone: Share → Add to Home Screen (iOS 16.4+)
  | 'opera-mini' // no install support: use Chrome
  | 'samsung'
  | 'android' // Chrome / Edge / Opera on Android
  | 'firefox-android'
  | 'desktop-chromium'
  | 'desktop-safari'
  | 'desktop-firefox'
  | 'other';

export function installPlatform(): InstallPlatform {
  if (typeof window === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (!window.isSecureContext) return 'insecure';
  const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return /crios|fxios|edgios|opios/i.test(ua) ? 'ios-other' : 'ios-safari';
  if (/opera mini|opios/i.test(ua)) return 'opera-mini';
  if (/android/i.test(ua)) {
    if (/samsungbrowser/i.test(ua)) return 'samsung';
    if (/firefox/i.test(ua)) return 'firefox-android';
    return 'android';
  }
  if (/firefox/i.test(ua)) return 'desktop-firefox';
  if (/edg\/|chrome\/|chromium|opr\//i.test(ua)) return 'desktop-chromium';
  if (/safari/i.test(ua)) return 'desktop-safari';
  return 'other';
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
    justInstalled = true;
    notify();
  });
  // Service workers only run on https:// or localhost.
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const url = import.meta.env.PROD ? '/sw.js' : '/sw.js?mode=dev';
  const start = () => {
    navigator.serviceWorker
      .register(url)
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        if (!import.meta.env.PROD) return;
        // Chunks fetched before the worker took over: ask it to keep them too.
        const urls = performance
          .getEntriesByType('resource')
          .map((entry) => new URL(entry.name, location.href))
          .filter((entry) => entry.origin === location.origin && entry.pathname.startsWith('/assets/'))
          .map((entry) => entry.pathname);
        registration.active?.postMessage({type: 'arena:cache-assets', urls});
      })
      .catch(() => undefined);
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, {once: true});
}

export interface InstallState {
  /** The browser handed us its install prompt: one tap installs. */
  canPrompt: boolean;
  /** Already running as the installed app (or installed just now). */
  installed: boolean;
  platform: InstallPlatform;
  /** Opens the native prompt. Resolves true when the player accepted. */
  install: () => Promise<boolean>;
}

export function useInstallPrompt(): InstallState {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    const media = window.matchMedia?.('(display-mode: standalone)');
    media?.addEventListener?.('change', fn);
    return () => {
      listeners.delete(fn);
      media?.removeEventListener?.('change', fn);
    };
  }, []);
  const installed = isStandalone() || justInstalled;
  return {
    canPrompt: !installed && deferred !== null,
    installed,
    platform: installPlatform(),
    install: async () => {
      const event = deferred;
      if (!event) return false;
      await event.prompt();
      const choice = await event.userChoice.catch(() => ({outcome: 'dismissed' as const}));
      deferred = null;
      if (choice.outcome === 'accepted') justInstalled = true;
      notify();
      return choice.outcome === 'accepted';
    },
  };
}
