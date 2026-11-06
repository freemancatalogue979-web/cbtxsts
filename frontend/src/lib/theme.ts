/**
 * Visual identity for the hub.
 *
 * Instead of one fixed colour, every area of the app gets its own accent and an
 * MLBB hero backdrop, so the place you are in is recognisable at a glance.
 * Members can pin a single accent or calm the effects down from the profile
 * menu; those choices are device-local, like the text style.
 *
 * Accent colours come in two flavours and both are contrast-checked against the
 * dark surfaces in `frontend/tests/theme.test.mjs`:
 *  - `text`  – light enough for small text on panels.
 *  - `solid` – dark enough for white text on a filled button.
 */

export const ACCENTS = [
  { id: "crimson", label: "Crimson", text: "#fda4af", solid: "#be123c", dim: "#3b1220", glow: "253 164 175" },
  { id: "emerald", label: "Emerald", text: "#34d399", solid: "#047857", dim: "#0d2f26", glow: "52 211 153" },
  { id: "cyan", label: "Aqua", text: "#22d3ee", solid: "#0e7490", dim: "#0b2b33", glow: "34 211 238" },
  { id: "violet", label: "Violet", text: "#a78bfa", solid: "#6d28d9", dim: "#241a3d", glow: "167 139 250" },
  { id: "fuchsia", label: "Magenta", text: "#e879f9", solid: "#a21caf", dim: "#331334", glow: "232 121 249" },
  { id: "amber", label: "Amber", text: "#fbbf24", solid: "#b45309", dim: "#33240b", glow: "251 191 36" },
  { id: "azure", label: "Azure", text: "#60a5fa", solid: "#1d4ed8", dim: "#14243d", glow: "96 165 250" },
  { id: "lime", label: "Lime", text: "#a3e635", solid: "#4d7c0f", dim: "#222c0d", glow: "163 230 53" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

export type SectionId =
  | "dashboard" | "ai" | "training" | "scrims" | "tournaments" | "esports" | "mlbb"
  | "reviews" | "heroes" | "intel" | "players" | "bans" | "drafts" | "maps"
  | "strategy" | "archive" | "events" | "notifications" | "admin" | "login";

export interface SectionTheme {
  accent: AccentId;
  /** Large hero art for the backdrop, by slug from `public/heroes`. */
  spotlight: string;
  /** Extra portraits that drift behind the shell. */
  shelf: string[];
}

/** Auto mode: colour and art depend on where you are, so the hub never looks static. */
export const SECTION_THEMES: Record<SectionId, SectionTheme> = {
  dashboard: { accent: "crimson", spotlight: "atlas", shelf: ["tigreal", "khufra", "baxia", "grock"] },
  ai: { accent: "emerald", spotlight: "angela", shelf: ["novaria", "yve", "selena", "harith"] },
  training: { accent: "cyan", spotlight: "chou", shelf: ["badang", "fredrinn", "yu-zhong", "akai"] },
  scrims: { accent: "violet", spotlight: "ling", shelf: ["benedetta", "lancelot", "fanny", "harith"] },
  tournaments: { accent: "amber", spotlight: "beatrix", shelf: ["lesley", "miya", "clint", "brody"] },
  esports: { accent: "azure", spotlight: "gusion", shelf: ["kagura", "harith", "julian", "yve"] },
  mlbb: { accent: "azure", spotlight: "alucard", shelf: ["miya", "lesley", "chou", "beatrix"] },
  reviews: { accent: "violet", spotlight: "selena", shelf: ["valentina", "kagura", "yve"] },
  heroes: { accent: "fuchsia", spotlight: "valentina", shelf: ["selena", "kagura", "ling"] },
  intel: { accent: "emerald", spotlight: "yve", shelf: ["novaria", "harith", "angela"] },
  players: { accent: "cyan", spotlight: "tigreal", shelf: ["akai", "baxia", "atlas"] },
  bans: { accent: "crimson", spotlight: "khufra", shelf: ["atlas", "grock", "akai"] },
  drafts: { accent: "lime", spotlight: "valentina", shelf: ["selena", "kagura", "chou"] },
  maps: { accent: "emerald", spotlight: "grock", shelf: ["akai", "atlas", "khufra"] },
  strategy: { accent: "amber", spotlight: "esmeralda", shelf: ["yve", "novaria", "harith"] },
  archive: { accent: "fuchsia", spotlight: "kagura", shelf: ["selena", "lesley", "miya"] },
  events: { accent: "amber", spotlight: "diggie", shelf: ["angela", "harith", "chou", "tigreal"] },
  notifications: { accent: "crimson", spotlight: "angela", shelf: ["tigreal", "atlas", "khufra", "novaria"] },
  admin: { accent: "azure", spotlight: "atlas", shelf: ["tigreal", "khufra", "baxia", "grock"] },
  login: { accent: "crimson", spotlight: "tigreal", shelf: ["atlas", "ling", "gusion"] },
};

export const SECTIONS = Object.keys(SECTION_THEMES) as SectionId[];

export function accentFor(id: AccentId) {
  return ACCENTS.find((accent) => accent.id === id) ?? ACCENTS[0];
}

/** Unknown routes fall back to the dashboard look instead of an undefined theme. */
export function sectionTheme(section: string | undefined | null): SectionTheme {
  return SECTION_THEMES[(section ?? "") as SectionId] ?? SECTION_THEMES.dashboard;
}

export function parseSection(section: string | undefined | null): SectionId {
  const id = (section ?? "").toLowerCase() as SectionId;
  return id in SECTION_THEMES ? id : "dashboard";
}

export function heroArt(slug: string, kind: "splash" | "head" = "splash"): string {
  // Art is bundled with the app (never fetched from a third-party CDN), so the
  // wallpaper works offline and cannot break when an outside host changes.
  return kind === "head" ? `/heroes/head-${slug}.webp` : `/heroes/${slug}.webp`;
}

/* ---------------------------------------------------------------- preferences */

export type ThemeMode = "auto" | AccentId;
export type EffectsMode = "full" | "calm";

export interface ThemePrefs {
  /** "auto" follows the current area; an accent id pins one colour everywhere. */
  mode: ThemeMode;
  /** MLBB hero art behind the shell. */
  backdrop: boolean;
  /** Drifting wallpaper and pointer parallax. */
  motion: boolean;
}

export const THEME_STORAGE_KEYS = {
  mode: "clover_theme_accent",
  backdrop: "clover_theme_backdrop",
  motion: "clover_theme_motion",
} as const;

export const DEFAULT_THEME_PREFS: ThemePrefs = { mode: "auto", backdrop: true, motion: true };

type StoredPrefs = { mode?: string | null; backdrop?: string | null | boolean; motion?: string | null | boolean };

/** Accepts raw storage strings as well as already-parsed preferences. */
export function parseThemePrefs(values: StoredPrefs): ThemePrefs {
  const mode = typeof values.mode === "string" && ACCENTS.some((accent) => accent.id === values.mode)
    ? values.mode as AccentId
    : "auto";
  return {
    mode,
    // Only the explicit opt-outs are stored, so new defaults reach everyone else.
    backdrop: values.backdrop !== "off" && values.backdrop !== false,
    motion: values.motion !== "calm" && values.motion !== false,
  };
}

function storageOf(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  try { return window.localStorage; } catch { return null; }
}

export function readThemePrefs(storage?: Storage | null): ThemePrefs {
  const store = storageOf(storage);
  try {
    return parseThemePrefs({
      mode: store?.getItem(THEME_STORAGE_KEYS.mode),
      backdrop: store?.getItem(THEME_STORAGE_KEYS.backdrop),
      motion: store?.getItem(THEME_STORAGE_KEYS.motion),
    });
  } catch {
    return { ...DEFAULT_THEME_PREFS };
  }
}

export function saveThemePrefs(storage: Storage | null, prefs: ThemePrefs): void {
  try {
    if (!storage) return;
    const parsed = parseThemePrefs(prefs);
    const write = (key: string, value: string | null) => { if (value === null) storage.removeItem(key); else storage.setItem(key, value); };
    write(THEME_STORAGE_KEYS.mode, parsed.mode === "auto" ? null : parsed.mode);
    write(THEME_STORAGE_KEYS.backdrop, parsed.backdrop ? null : "off");
    write(THEME_STORAGE_KEYS.motion, parsed.motion ? null : "calm");
  } catch { /* Private mode or a full quota: the in-memory choice still applies. */ }
}

/** Resolved accent for the current area and preference. */
export function resolvedAccent(prefs: ThemePrefs, section: string | undefined | null): AccentId {
  return prefs.mode === "auto" ? sectionTheme(section).accent : prefs.mode;
}

/**
 * Push the theme onto the document. Everything visual keys off these data
 * attributes, so no component needs to know the palette.
 */
export function applyTheme(prefs: ThemePrefs, section: string | undefined | null, root?: HTMLElement | null): void {
  const element = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!element) return;
  const safe = parseThemePrefs(prefs);
  element.dataset.accent = resolvedAccent(safe, section);
  element.dataset.section = parseSection(section);
  element.dataset.backdrop = safe.backdrop ? "hero" : "plain";
  element.dataset.effects = safe.motion ? "full" : "calm";
}
