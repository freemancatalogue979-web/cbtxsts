/**
 * Official MLBB wallpapers (mobilelegends.com/m/gallery) as the hub background.
 *
 * The server saves the newest gallery wallpapers daily (`/api/wallpapers`); until it has any, the
 * list holds the gallery page's own pictures straight from Moonton. The choice is device-local:
 *  - ""      hero art per area (the default backdrop)
 *  - "mix"   every area gets its own wallpaper
 *  - <id>    one wallpaper everywhere
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "./api";

export interface Wallpaper {
  id: string; title: string; heroes: string[];
  desktop: string; mobile: string; thumb: string; local: boolean;
}
export interface WallpaperGallery {
  items: Wallpaper[]; enabled: boolean; last_at?: string | null; source: string; error: string; refreshing?: boolean;
}

export const WALLPAPER_STORAGE_KEY = "clover_wallpaper";
export type WallpaperChoice = "" | "mix" | string;

const listeners = new Set<() => void>();
let choice: WallpaperChoice = readChoice();

function store(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function parseChoice(value: unknown): WallpaperChoice {
  return typeof value === "string" && /^(mix|[a-z0-9]{1,40})$/.test(value) ? value : "";
}

function readChoice(): WallpaperChoice {
  try { return parseChoice(store()?.getItem(WALLPAPER_STORAGE_KEY)); } catch { return ""; }
}

export function getWallpaperChoice(): WallpaperChoice { return choice; }

export function setWallpaperChoice(next: WallpaperChoice): void {
  choice = parseChoice(next);
  try {
    const s = store();
    if (choice) s?.setItem(WALLPAPER_STORAGE_KEY, choice); else s?.removeItem(WALLPAPER_STORAGE_KEY);
  } catch { /* private mode: the in-memory choice still applies */ }
  listeners.forEach((fn) => fn());
}

export function subscribeWallpaper(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

let cached: Promise<WallpaperGallery> | null = null;
let galleryVersion = 0;
const getGalleryVersion = () => galleryVersion;

/** One request per session (refresh=true after an admin pulls the newest set). */
export function loadWallpapers(refresh = false): Promise<WallpaperGallery> {
  if (!cached || refresh) {
    cached = api.get<WallpaperGallery>("/wallpapers").catch((err) => { cached = null; throw err; });
    if (refresh) void cached.then(() => { galleryVersion++; listeners.forEach((fn) => fn()); }, () => undefined);
  }
  return cached;
}

/** Stable per-area pick for "mix", so an area keeps its wallpaper between visits. */
export function wallpaperFor(items: Wallpaper[], pick: WallpaperChoice, section: string): Wallpaper | null {
  if (!pick || !items.length || section === "login") return null;
  if (pick === "mix") {
    let hash = 0;
    for (const ch of section) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return items[hash % items.length];
  }
  return items.find((w) => w.id === pick) ?? null;
}

/** The wallpaper behind the given area, or null for the hero-art backdrop. */
export function useWallpaper(section: string): Wallpaper | null {
  const pick = useSyncExternalStore(subscribeWallpaper, getWallpaperChoice);
  const version = useSyncExternalStore(subscribeWallpaper, getGalleryVersion);
  const [items, setItems] = useState<Wallpaper[]>([]);
  const wanted = Boolean(pick) && section !== "login";
  useEffect(() => {
    if (!wanted) return;
    let active = true;
    loadWallpapers().then((g) => { if (active) setItems(g.items); }).catch(() => { /* hero art stays */ });
    return () => { active = false; };
  }, [wanted, version]);
  return wanted ? wallpaperFor(items, pick, section) : null;
}
