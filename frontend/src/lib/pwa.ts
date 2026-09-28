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

/** True once the browser has handed over its install prompt (Chrome/Edge/Samsung). */
export function hasInstallPrompt(): boolean {
  return deferred !== null;
}

/** WhatsApp / Facebook / Instagram / TikTok in-app browsers cannot install apps. */
export function inAppBrowser(): string | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/WhatsApp/i.test(ua)) return 'WhatsApp';
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) return 'TikTok';
  if (/Telegram/i.test(ua)) return 'Telegram';
  if (/Snapchat/i.test(ua)) return 'Snapchat';
  if (/Android/i.test(ua) && /; wv\)/.test(ua)) return 'an in-app';
  return null;
}

/** localhost or a private network address (Wi-Fi LAN): Chrome on Android only makes shortcuts there. */
export function isLocalAddress(host = typeof location !== 'undefined' ? location.hostname : ''): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === '[::1]'
  );
}

export function inFrame(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

/** Android intent link that reopens this exact page in Chrome (from WhatsApp etc.). */
export function openInChromeUrl(): string {
  const {host, pathname, search, hash} = location;
  return `intent://${host}${pathname}${search}${hash}#Intent;scheme=https;package=com.android.chrome;end`;
}

export type CheckState = 'ok' | 'warn' | 'fail' | 'wait';
export interface InstallCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
}

/**
 * Everything Chrome looks at before it offers a real install (not a shortcut),
 * checked on the player's own phone so the reason is visible, not guessed.
 */
export async function runInstallChecks(): Promise<InstallCheck[]> {
  const checks: InstallCheck[] = [];
  const host = location.host;
  const iab = inAppBrowser();
  checks.push(
    iab
      ? {id: 'browser', label: 'Real browser', state: 'fail', detail: `This page is open inside ${iab} browser, which can't install apps. Tap ⋮ and choose "Open in Chrome" (or copy the link into Chrome).`}
      : {id: 'browser', label: 'Real browser', state: 'ok', detail: 'Opened in a normal browser.'},
  );
  checks.push(
    inFrame()
      ? {id: 'frame', label: 'Own tab', state: 'fail', detail: 'The app is shown inside another page (a preview frame). Open the link in its own Chrome tab.'}
      : {id: 'frame', label: 'Own tab', state: 'ok', detail: 'Open in its own tab.'},
  );
  checks.push(
    window.isSecureContext
      ? {id: 'https', label: 'Secure address (https)', state: 'ok', detail: `${location.protocol}//${host}`}
      : {id: 'https', label: 'Secure address (https)', state: 'fail', detail: `${location.protocol}//${host} is plain http. Browsers only install from https:// (or localhost on the same computer). Use the https link.`},
  );
  const android = /android/i.test(navigator.userAgent);
  if (isLocalAddress()) {
    checks.push({
      id: 'public',
      label: 'Public address',
      state: android ? 'fail' : 'warn',
      detail: android
        ? `${location.hostname} is a local address. Chrome on Android can only make a shortcut for it, not an app. Use a public https link (hosting or an https tunnel).`
        : `${location.hostname} is a local address: installing works on this computer only.`,
    });
  } else {
    checks.push({id: 'public', label: 'Public address', state: 'ok', detail: location.hostname});
  }
  // Service worker
  let sw: InstallCheck = {id: 'sw', label: 'Service worker', state: 'fail', detail: 'Not supported in this browser.'};
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg?.active) sw = {id: 'sw', label: 'Service worker', state: 'ok', detail: 'Running.'};
      else if (reg) sw = {id: 'sw', label: 'Service worker', state: 'wait', detail: 'Starting… reload the page once.'};
      else sw = {id: 'sw', label: 'Service worker', state: window.isSecureContext ? 'fail' : 'fail', detail: window.isSecureContext ? 'Not registered yet. Reload the page once.' : 'Blocked because the address is not https.'};
    } catch (error) {
      sw = {id: 'sw', label: 'Service worker', state: 'fail', detail: `Could not start: ${(error as Error).message}`};
    }
  }
  checks.push(sw);
  // Manifest + icons, fetched the way the browser does
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    checks.push({id: 'manifest', label: 'App manifest', state: 'fail', detail: 'No manifest link on the page (old version of the site). Update and reload.'});
  } else {
    try {
      const response = await fetch(link.href, {credentials: 'include', cache: 'no-store'});
      const text = await response.text();
      let manifest: {name?: string; icons?: {src: string; sizes?: string}[]; start_url?: string; display?: string} | null = null;
      try {
        manifest = JSON.parse(text);
      } catch {
        manifest = null;
      }
      if (!response.ok || !manifest) {
        checks.push({
          id: 'manifest',
          label: 'App manifest',
          state: 'fail',
          detail: `The server answered ${response.status}${manifest ? '' : ' with a web page instead of the manifest (a login or proxy page is in the way)'}. Chrome can then only make a shortcut.`,
        });
      } else {
        checks.push({id: 'manifest', label: 'App manifest', state: 'ok', detail: `${manifest.name} · ${manifest.display}`});
        const wanted = ['192x192', '512x512'];
        const icons = (manifest.icons ?? []).filter((icon) => wanted.some((size) => icon.sizes?.includes(size)));
        const results = await Promise.all(
          icons.map(async (icon) => {
            try {
              const r = await fetch(new URL(icon.src, link.href), {credentials: 'include', cache: 'no-store'});
              return r.ok && (r.headers.get('content-type') || '').startsWith('image/');
            } catch {
              return false;
            }
          }),
        );
        const good = icons.length >= 2 && results.every(Boolean);
        checks.push(
          good
            ? {id: 'icons', label: 'App icons', state: 'ok', detail: '192 px and 512 px icons load.'}
            : {id: 'icons', label: 'App icons', state: 'fail', detail: 'The app icons did not load (blocked or missing). Reload; if it stays, the server is blocking /brand/ files.'},
        );
      }
    } catch (error) {
      checks.push({id: 'manifest', label: 'App manifest', state: 'fail', detail: `Could not load it: ${(error as Error).message}`});
    }
  }
  const standalone = isStandalone();
  checks.push(
    standalone
      ? {id: 'prompt', label: 'Browser install offer', state: 'ok', detail: 'Already installed and running as the app.'}
      : deferred
        ? {id: 'prompt', label: 'Browser install offer', state: 'ok', detail: 'Ready: the Install button installs in one tap.'}
        : {
            id: 'prompt',
            label: 'Browser install offer',
            state: 'warn',
            detail: /iphone|ipad|ipod/i.test(navigator.userAgent)
              ? 'iPhone never offers one: use Share → Add to Home Screen.'
              : 'Not offered yet. If everything above is green, tap around for a few seconds and reopen this sheet, or use Chrome menu ⋮ → Install app. If you installed before and removed it, Chrome may wait a while before offering again.',
          },
  );
  return checks;
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
