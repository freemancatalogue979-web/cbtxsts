/**
 * Hero wallpaper resolution.
 *
 * The bundled portraits (`/heroes/<slug>.webp`, 240×390) are the local-first
 * default: they always paint, offline included. On large or high-DPR screens
 * they would be upscaled and look soft, so the wallpaper quietly upgrades to a
 * sharper source when one is available:
 *
 *   1. `/heroes/hi/<slug>.webp` — optional high-resolution pack committed to the
 *      repo by `frontend/scripts/fetch-hero-art.mjs` (fully local, best option).
 *   2. The official catalogue painting / 1080×1920 wallpaper already indexed by
 *      `ensureArtIndex()` (Rone backup the rest of the app uses for hero art).
 *   3. Otherwise the bundled portrait stays, and the CSS keeps it at native
 *      pixel size so it is still crisp.
 *
 * Nothing here touches the backend and no failure is user-visible: a 404, an
 * offline browser or a slow host just leaves the bundled art in place.
 */
import { artFor, subscribeArt } from "./mlbb";

export const LOCAL_SPLASH = (slug: string) => `/heroes/${slug}.webp`;
export const HD_SPLASH = (slug: string) => `/heroes/hi/${slug}.webp`;
/** Written by scripts/fetch-hero-art.mjs; absent until the HD pack is built. */
export const HD_MANIFEST = "/heroes/hi/manifest.json";

/** Bundled portrait dimensions, used to avoid upscaling local art. */
export const LOCAL_ART = { width: 240, height: 390 } as const;

/** The catalogue keys heroes by name (`"yu zhong"`), while our slugs use dashes. */
export function heroNameCandidates(slug: string): string[] {
  const clean = slug.trim().toLowerCase();
  if (!clean) return [];
  const spaced = clean.replace(/-+/g, " ");
  return clean === spaced ? [clean] : [clean, spaced];
}

function safeHttps(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Official catalogue painting for a slug, if the art index has one. */
export function officialSplash(slug: string): string | null {
  for (const name of heroNameCandidates(slug)) {
    const url = safeHttps(artFor(name)?.art);
    if (url) return url;
  }
  return null;
}

/**
 * Ordered upgrade candidates: repo HD pack first, then the catalogue painting.
 * `hdSlugs` comes from the pack manifest, so we never fire a request for a file
 * that was not built (a missing image would otherwise cost an HTML fallback).
 */
export function splashCandidates(slug: string, hdSlugs?: Set<string>): string[] {
  const urls: (string | null)[] = [hdSlugs?.has(slug) ? HD_SPLASH(slug) : null, officialSplash(slug)];
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

let hdManifest: Promise<Set<string>> | null = null;
/** Slugs present in the optional high-resolution pack. Cached for the session. */
export function loadHdManifest(fetcher: typeof fetch | null = typeof fetch === "function" ? fetch : null): Promise<Set<string>> {
  if (hdManifest) return hdManifest;
  hdManifest = (async () => {
    if (!fetcher) return new Set<string>();
    try {
      const response = await fetcher(HD_MANIFEST, { cache: "force-cache" });
      if (!response.ok) return new Set<string>();
      const payload: unknown = await response.json();
      const list = Array.isArray(payload) ? payload : (payload as { files?: unknown[] })?.files;
      return new Set((Array.isArray(list) ? list : []).map((name) => String(name).replace(/\.webp$/i, "").toLowerCase()));
    } catch {
      return new Set<string>();
    }
  })();
  return hdManifest;
}

export function resetHdManifest(): void { hdManifest = null; }

/**
 * Should we even try a network upgrade? Bundled art is enough on small or
 * standard screens, and there is no point on a phone data connection.
 */
export function shouldUpgradeArt(env: { width?: number; online?: boolean } = {}): boolean {
  const width = env.width ?? (typeof window === "undefined" ? 0 : window.innerWidth);
  const online = env.online ?? (typeof navigator === "undefined" ? true : navigator.onLine !== false);
  if (!online) return false;
  // Only large screens ask for the sharper source. Phones (even at 3x DPR) keep
  // the bundled portrait at native pixel size: sharp, and no extra data cost.
  return width >= 1024;
}

/* ------------------------------------------------------------------ probing */

export type Probe = (url: string) => Promise<boolean>;

const resolved = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();
const missed = new Set<string>();
const listeners = new Set<() => void>();

/** The default probe loads the image and decodes it, so a swapped-in src can't flash empty. */
export const browserProbe: Probe = (url) => new Promise((resolve) => {
  if (typeof Image === "undefined") { resolve(false); return; }
  const image = new Image();
  let settled = false;
  const finish = (ok: boolean) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    image.onload = null;
    image.onerror = null;
    resolve(ok);
  };
  const timer = window.setTimeout(() => finish(false), 8000);
  image.onload = () => {
    // Reject SPA fallbacks that answer 200 with HTML instead of an image.
    finish(image.naturalWidth > 1 && image.naturalHeight > 1);
  };
  image.onerror = () => finish(false);
  image.referrerPolicy = "no-referrer";
  image.decoding = "async";
  image.src = url;
});

/** Already-known answer for a slug (used to paint the first frame without a flash). */
export function cachedSplash(slug: string): string | null | undefined {
  return resolved.get(slug);
}

export function clearSplashCache(): void {
  resolved.clear();
  inFlight.clear();
  missed.clear();
}

async function resolveSplash(slug: string, probe: Probe, hdSlugs: Set<string>): Promise<string | null> {
  if (resolved.has(slug)) return resolved.get(slug) ?? null;
  const pending = inFlight.get(slug);
  if (pending) return pending;
  const run = (async () => {
    for (const url of splashCandidates(slug, hdSlugs)) {
      // The HD pack may be absent; the catalogue URL may be blocked or stale.
      // Either way, keep looking rather than showing a broken frame.
      if (await probe(url)) {
        resolved.set(slug, url);
        listeners.forEach((fn) => fn());
        return url;
      }
    }
    resolved.set(slug, null);
    missed.add(slug);
    return null;
  })();
  inFlight.set(slug, run);
  try { return await run; } finally { inFlight.delete(slug); }
}

/** Notify a component when a slug finally has a sharper source. */
export function subscribeSplash(fn: () => void): () => void {
  listeners.add(fn);
  // The catalogue index arrives after login. Slugs that only had the bundled
  // portrait get one more chance once an official painting becomes known.
  const offArt = subscribeArt(() => {
    for (const slug of [...missed]) {
      if (!officialSplash(slug)) continue;
      missed.delete(slug);
      resolved.delete(slug);
    }
    fn();
  });
  return () => { listeners.delete(fn); offArt(); };
}

/**
 * Ask for the sharpest available art for these slugs. Resolves to a map of
 * slug → URL; missing slugs simply keep their bundled portrait.
 */
export async function resolveWallArt(
  slugs: string[],
  probe: Probe = browserProbe,
  manifest?: Set<string>,
): Promise<Record<string, string>> {
  const hdSlugs = manifest ?? await loadHdManifest();
  const unique = [...new Set(slugs)];
  const found = await Promise.all(unique.map(async (slug) => [slug, await resolveSplash(slug, probe, hdSlugs)] as const));
  return Object.fromEntries(found.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));
}
