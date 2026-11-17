// Installable app support: service worker registration, the "new version"
// signal and the browser's install prompt, exposed as a tiny external store
// for React (useSyncExternalStore). Production builds only; in development any
// worker left over from a preview build is removed so it never serves stale code.

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type PwaState = {
  /** The browser offered an install prompt we can trigger from a button. */
  canInstall: boolean;
  /** Already running as an installed app (home screen / desktop window). */
  standalone: boolean;
  /** iPhone/iPad Safari: no prompt API, show "Share → Add to Home Screen". */
  iosHint: boolean;
  /** A new version is downloaded and waiting for a reload. */
  updateReady: boolean;
  /** Network status, for the offline banner. */
  online: boolean;
};

let deferred: InstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;
let state: PwaState = {
  canInstall: false,
  standalone: false,
  iosHint: false,
  updateReady: false,
  online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
};
const listeners = new Set<() => void>();

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribePwa(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaState(): PwaState {
  return state;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return Boolean(nav.standalone) || window.matchMedia?.("(display-mode: standalone)").matches
    || window.matchMedia?.("(display-mode: minimal-ui)").matches;
}

export function isIosSafari(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent, touchPoints = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
  // Chrome/Firefox/Edge on iOS have their own share menus; the Safari wording fits them closely enough,
  // but in-app browsers (Instagram, etc.) cannot install at all.
  return ios && !/FBAN|FBAV|Instagram|Line\//.test(userAgent);
}

/** Show the browser's install dialog. Returns true when the member accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  set({ canInstall: false });
  await event.prompt();
  const choice = await event.userChoice.catch(() => ({ outcome: "dismissed" as const }));
  return choice.outcome === "accepted";
}

/** Activate the waiting version; the page reloads once it takes control. */
export function applyUpdate() {
  if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
  else window.location.reload();
}

function watch(registration: ServiceWorkerRegistration) {
  const offer = (worker: ServiceWorker | null) => {
    // Only an *update* needs a reload; the very first install already controls nothing.
    if (worker && navigator.serviceWorker.controller) {
      waiting = worker;
      set({ updateReady: true });
    }
  };
  if (registration.waiting) offer(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offer(worker);
    });
  });
  // Installed apps stay open for days: look for a new deploy every 30 minutes and on focus.
  const check = () => { registration.update().catch(() => {}); };
  window.setInterval(check, 30 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
}

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  set({ standalone: isStandalone(), iosHint: isIosSafari() && !isStandalone() });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); // keep the mini-infobar away; our button triggers it
    deferred = event as InstallPromptEvent;
    set({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    set({ canInstall: false, standalone: true, iosHint: false });
  });
  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", () => set({ standalone: isStandalone() }));
  window.addEventListener("online", () => set({ online: true }));
  window.addEventListener("offline", () => set({ online: false }));

  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) {
    navigator.serviceWorker.getRegistrations().then((all) => all.forEach((r) => r.unregister())).catch(() => {});
    return;
  }
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!waiting || reloading) return; // first install: nothing to reload
    reloading = true;
    window.location.reload();
  });
  const register = () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(watch).catch(() => {});
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
