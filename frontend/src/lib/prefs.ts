/**
 * Player preferences that live on the device (never in the database):
 * theme, mascot and sound. Applied before first paint where it matters.
 */

export type ThemeName = 'arena' | 'ember' | 'ocean' | 'venom' | 'candy' | 'mono';

export const THEMES: {id: ThemeName; name: string; blurb: string; short: string; dots: string[]}[] = [
  {id: 'arena', name: 'Arena', blurb: 'The house look — rose, violet, electric blue.', short: 'Rose, violet, blue.', dots: ['#f43f5e', '#a855f7', '#3b82f6']},
  {id: 'ember', name: 'Ember', blurb: 'Hot reds and oranges, like a LAN at midnight.', short: 'Hot reds and oranges.', dots: ['#ef4444', '#f97316', '#fbbf24']},
  {id: 'ocean', name: 'Ocean', blurb: 'Coral on cyan and deep sea blue.', short: 'Coral on deep sea blue.', dots: ['#fb7185', '#06b6d4', '#3b82f6']},
  {id: 'venom', name: 'Venom', blurb: 'Toxic lime and emerald for the sweaty tryhards.', short: 'Toxic lime and emerald.', dots: ['#ef4444', '#84cc16', '#10b981']},
  {id: 'candy', name: 'Candy', blurb: 'Bubblegum pink, orchid and periwinkle.', short: 'Pink and periwinkle.', dots: ['#ec4899', '#c084fc', '#818cf8']},
  {id: 'mono', name: 'Mono', blurb: 'Pure black & white — no colour, all focus.', short: 'Black and white only.', dots: ['#ffffff', '#a3a3a3', '#404040']},
];

export type MascotName = 'bolt' | 'pixel' | 'goober';

export const MASCOTS: {id: MascotName; name: string; blurb: string; short: string}[] = [
  {id: 'bolt', name: 'Bolt', blurb: 'A stickman with a lightning headband. Pure energy.', short: 'Lightning-headband stickman.'},
  {id: 'pixel', name: 'Pixel', blurb: 'A pocket robot who beeps when you combo.', short: 'Pocket robot that beeps.'},
  {id: 'goober', name: 'Goober', blurb: 'A friendly blob of arena slime. Squishy morale officer.', short: 'Friendly arena slime blob.'},
];

/* ------------------------------------------------------------------ modes */
export type ModeName = 'game' | 'pro' | 'fun';

export const MODES: {id: ModeName; name: string; blurb: string; short: string}[] = [
  {id: 'game', name: 'Game', blurb: 'The full arena HUD — glows, mascots, gold titles.', short: 'Full arena HUD.'},
  {id: 'pro', name: 'Pro', blurb: 'Clean and professional. No mascots, flat surfaces.', short: 'Clean and professional.'},
  {id: 'fun', name: 'Fun', blurb: 'Bouncy, wiggly, extra sparkly. Pure playground.', short: 'Bouncy and sparkly.'},
];

/* ------------------------------------------------------------------ fonts */
export type FontName = 'magic' | 'montserrat' | 'arena' | 'grotesk' | 'orbit';

export const FONTS: {id: FontName; name: string; blurb: string; short: string; sans: string; display: string}[] = [
  {
    id: 'magic',
    name: 'Quite Magical',
    blurb: 'The house face — a warm hand-lettered script with a serious edge.',
    short: 'Hand-lettered house face.',
    sans: "'Quite Magical', 'Space Grotesk Variable', ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif",
    display: "'Quite Magical', 'Space Grotesk Variable', 'Audiowide', ui-sans-serif, sans-serif",
  },
  {
    id: 'montserrat',
    name: 'Montserrat',
    blurb: 'Geometric and friendly, reads great on phones.',
    short: 'Geometric and friendly.',
    sans: "'Montserrat Variable', ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif",
    display: "'Audiowide', 'Montserrat Variable', ui-sans-serif, sans-serif",
  },
  {
    id: 'arena',
    name: 'Exo 2',
    blurb: 'The classic arena body font with the Audiowide display.',
    short: 'Classic arena body font.',
    sans: "'Exo 2', ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif",
    display: "'Audiowide', 'Orbitron', 'Exo 2', ui-sans-serif, sans-serif",
  },
  {
    id: 'grotesk',
    name: 'Space Grotesk',
    blurb: 'Modern and minimal — one family everywhere.',
    short: 'Modern and minimal.',
    sans: "'Space Grotesk Variable', ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif",
    display: "'Space Grotesk Variable', 'Audiowide', ui-sans-serif, sans-serif",
  },
  {
    id: 'orbit',
    name: 'Orbitron',
    blurb: 'Sci-fi display over a clean Montserrat body.',
    short: 'Sci-fi display face.',
    sans: "'Montserrat Variable', ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif",
    display: "'Orbitron', 'Audiowide', 'Montserrat Variable', ui-sans-serif, sans-serif",
  },
];

/* ------------------------------------------------------------------ skins */
/**
 * Day / night. The arena boots into the **night** deep-ink arena glow; the
 * daylight cartoon world stays one tap away for anyone who wants sky, meadow
 * and parchment. The skin only re-maps tokens (surfaces, type, edges) — themes
 * still tint the accents on top of either.
 */
export type SkinName = 'day' | 'night';

export const SKINS: {id: SkinName; name: string; blurb: string; short: string; dots: string[]}[] = [
  {id: 'night', name: 'Night', blurb: 'Deep-ink arena glow — the default.', short: 'Deep-ink arena glow.', dots: ['#0b1030', '#a855f7', '#3b82f6']},
  {id: 'day', name: 'Daylight', blurb: 'Bright adventure world — sky, meadow and parchment panels.', short: 'Bright adventure world.', dots: ['#5ac8fa', '#34c759', '#ffcc00']},
];

const SKIN_KEY = 'arena.skin';
export const DEFAULT_SKIN: SkinName = 'night';

export function currentSkin(): SkinName {
  const stored = read(SKIN_KEY, DEFAULT_SKIN);
  return (SKINS.some((skin) => skin.id === stored) ? stored : DEFAULT_SKIN) as SkinName;
}

export function applySkin(name: SkinName): void {
  document.documentElement.dataset.skin = name;
  write(SKIN_KEY, name);
}

const THEME_KEY = 'arena.theme';
const MODE_KEY = 'arena.mode';
const FONT_KEY = 'arena.font.v3';
const MASCOT_KEY = 'arena.mascot';
const SOUND_KEY = 'arena.sound';
const MUSIC_KEY = 'arena.music';

function read(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode — prefs just won't persist */
  }
}

export function currentTheme(): ThemeName {
  const stored = read(THEME_KEY, 'arena');
  return (THEMES.some((theme) => theme.id === stored) ? stored : 'arena') as ThemeName;
}

export function applyTheme(name: ThemeName): void {
  document.documentElement.dataset.theme = name;
  write(THEME_KEY, name);
}

export function currentMascot(): MascotName {
  const stored = read(MASCOT_KEY, 'bolt');
  return (MASCOTS.some((mascot) => mascot.id === stored) ? stored : 'bolt') as MascotName;
}

export function setMascot(name: MascotName): void {
  write(MASCOT_KEY, name);
}

export function soundOn(): boolean {
  return read(SOUND_KEY, 'on') === 'on';
}

export function setSoundOn(on: boolean): void {
  write(SOUND_KEY, on ? 'on' : 'off');
}

export function musicOn(): boolean {
  return read(MUSIC_KEY, 'on') === 'on';
}

export function setMusicOn(on: boolean): void {
  write(MUSIC_KEY, on ? 'on' : 'off');
}

/**
 * The uploaded soundtrack. Older builds shipped synthesised track ids
 * ('arena' | 'neon' | 'focus' | 'boss'); a stored value that is not one of
 * these falls back to the first file, so an existing player hears the real
 * music instead of a leftover synth track.
 */
export type MusicTrackId = 'rock' | 'arcade' | 'surfer';

const MUSIC_TRACK_KEY = 'arena.musicTrack';
const MUSIC_VOL_KEY = 'arena.musicVol';
const MUSIC_TRACK_IDS: MusicTrackId[] = ['rock', 'arcade', 'surfer'];

export function musicTrack(): MusicTrackId {
  const stored = read(MUSIC_TRACK_KEY, 'rock');
  return (MUSIC_TRACK_IDS.includes(stored as MusicTrackId) ? stored : 'rock') as MusicTrackId;
}

export function setMusicTrack(id: MusicTrackId): void {
  write(MUSIC_TRACK_KEY, id);
}

export function musicVolume(): number {
  const value = Number(read(MUSIC_VOL_KEY, '70'));
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 70;
}

export function setMusicVolume(value: number): void {
  write(MUSIC_VOL_KEY, String(Math.max(0, Math.min(100, Math.round(value)))));
}


export function currentMode(): ModeName {
  const stored = read(MODE_KEY, 'game');
  return (MODES.some((mode) => mode.id === stored) ? stored : 'game') as ModeName;
}

export function applyMode(name: ModeName): void {
  document.documentElement.dataset.mode = name;
  write(MODE_KEY, name);
}

/** Space Grotesk is the house default; a stored choice always wins. */
export const DEFAULT_FONT: FontName = 'grotesk';

export function currentFont(): FontName {
  const stored = read(FONT_KEY, DEFAULT_FONT);
  return (FONTS.some((font) => font.id === stored) ? stored : DEFAULT_FONT) as FontName;
}

export function applyFont(name: FontName): void {
  const font = FONTS.find((option) => option.id === name) ?? FONTS.find((option) => option.id === DEFAULT_FONT) ?? FONTS[0];
  const style = document.documentElement.style;
  style.setProperty('--font-sans', font.sans);
  style.setProperty('--font-display', font.display);
  write(FONT_KEY, name);
}
