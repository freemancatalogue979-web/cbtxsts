/**
 * Experience modes — one account, one set of data, different interfaces.
 *
 *   Standard  ('game' | 'fun' in prefs)  engaging, visual, gamified
 *   Pro       ('pro')                    quiet, focused, professional
 *
 * Only the *experience* changes: courses, progress, question history and
 * conversations are the same backend records in both. Pro also owns a small
 * set of reading / appearance preferences that live on the device.
 *
 * `isPro()` is the single check the rest of the app uses (music, sound
 * effects, confetti, haptics and celebration pop-ups all go quiet in Pro).
 */
import {useSyncExternalStore} from 'react';
import {applyFont, applyMode, currentFont, currentMode, type ModeName} from './prefs';

const PRO_FONT = "'AG Helvetica Oblique', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const APPEARANCE_KEY = 'arena.pro.appearance';
const READ_SIZE_KEY = 'arena.pro.readSize';
const READ_WIDTH_KEY = 'arena.pro.readWidth';
const LINE_KEY = 'arena.pro.lineHeight';
const LAST_STANDARD_KEY = 'arena.mode.standard';

export type Appearance = 'dark' | 'light' | 'system';
export type ReadSize = 'sm' | 'md' | 'lg' | 'xl';
export type ReadWidth = 'narrow' | 'normal' | 'wide';
export type LineHeight = 'compact' | 'normal' | 'relaxed';

export const READ_SIZES: {id: ReadSize; label: string; px: number}[] = [
  {id: 'sm', label: 'Small', px: 14},
  {id: 'md', label: 'Default', px: 15},
  {id: 'lg', label: 'Large', px: 16.5},
  {id: 'xl', label: 'Extra large', px: 18},
];
export const READ_WIDTHS: {id: ReadWidth; label: string; ch: number}[] = [
  {id: 'narrow', label: 'Narrow', ch: 62},
  {id: 'normal', label: 'Default', ch: 74},
  {id: 'wide', label: 'Wide', ch: 96},
];
export const LINE_HEIGHTS: {id: LineHeight; label: string; value: number}[] = [
  {id: 'compact', label: 'Compact', value: 1.45},
  {id: 'normal', label: 'Default', value: 1.62},
  {id: 'relaxed', label: 'Relaxed', value: 1.8},
];

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
    /* private mode — the choice lasts for this visit */
  }
}

/* ------------------------------------------------------------ store */
const listeners = new Set<() => void>();
let version = 0;
function emit(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isPro(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.mode === 'pro';
}

/* ------------------------------------------------------ appearance */
export function currentAppearance(): Appearance {
  const stored = read(APPEARANCE_KEY, 'dark');
  return stored === 'light' || stored === 'system' ? stored : 'dark';
}

let systemQuery: MediaQueryList | null = null;
function resolvedAppearance(choice: Appearance): 'dark' | 'light' {
  if (choice !== 'system') return choice;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function paintAppearance(): void {
  const root = document.documentElement;
  const choice = currentAppearance();
  root.dataset.proTheme = resolvedAppearance(choice);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && isPro()) meta.setAttribute('content', root.dataset.proTheme === 'light' ? '#F7F8FA' : '#0B0D10');
}

export function setAppearance(choice: Appearance): void {
  write(APPEARANCE_KEY, choice);
  paintAppearance();
  emit();
}

/* --------------------------------------------------------- reading */
export function readingPrefs(): {size: ReadSize; width: ReadWidth; line: LineHeight} {
  const size = read(READ_SIZE_KEY, 'md') as ReadSize;
  const width = read(READ_WIDTH_KEY, 'normal') as ReadWidth;
  const line = read(LINE_KEY, 'normal') as LineHeight;
  return {
    size: READ_SIZES.some((row) => row.id === size) ? size : 'md',
    width: READ_WIDTHS.some((row) => row.id === width) ? width : 'normal',
    line: LINE_HEIGHTS.some((row) => row.id === line) ? line : 'normal',
  };
}

function paintReading(): void {
  const prefs = readingPrefs();
  const style = document.documentElement.style;
  style.setProperty('--pro-read-size', `${READ_SIZES.find((row) => row.id === prefs.size)?.px ?? 15}px`);
  style.setProperty('--pro-read-width', `${READ_WIDTHS.find((row) => row.id === prefs.width)?.ch ?? 74}ch`);
  style.setProperty('--pro-line', String(LINE_HEIGHTS.find((row) => row.id === prefs.line)?.value ?? 1.62));
}

export function setReadingPref(key: 'size' | 'width' | 'line', value: string): void {
  write(key === 'size' ? READ_SIZE_KEY : key === 'width' ? READ_WIDTH_KEY : LINE_KEY, value);
  paintReading();
  emit();
}

/* ------------------------------------------------------ experience */
/** The Standard flavour to return to ('game' or 'fun'). */
function lastStandard(): ModeName {
  const stored = read(LAST_STANDARD_KEY, 'game');
  return stored === 'fun' ? 'fun' : 'game';
}

/** Apply the stored mode before first paint (called from main.tsx). */
export function bootExperience(): void {
  const mode = currentMode();
  applyMode(mode);
  paintReading();
  paintAppearance();
  if (mode === 'pro') {
    document.documentElement.style.setProperty('--font-sans', PRO_FONT);
    document.documentElement.style.setProperty('--font-display', PRO_FONT);
  }
  if (typeof window !== 'undefined' && window.matchMedia && !systemQuery) {
    systemQuery = window.matchMedia('(prefers-color-scheme: light)');
    systemQuery.addEventListener?.('change', () => {
      if (currentAppearance() === 'system') {
        paintAppearance();
        emit();
      }
    });
  }
}

/**
 * Switch the experience. Everything the player owns stays exactly where it
 * is; only the interface (and its sound / motion policy) changes.
 */
export function setExperience(next: 'standard' | 'pro' | ModeName): void {
  const target: ModeName = next === 'standard' ? lastStandard() : next;
  const was = currentMode();
  if (was !== 'pro') write(LAST_STANDARD_KEY, was);
  applyMode(target);
  const style = document.documentElement.style;
  if (target === 'pro') {
    style.setProperty('--font-sans', PRO_FONT);
    style.setProperty('--font-display', PRO_FONT);
  } else {
    applyFont(currentFont());
  }
  paintAppearance();
  emit();
  window.dispatchEvent(new CustomEvent(EXPERIENCE_EVENT, {detail: {mode: target}}));
}

export const EXPERIENCE_EVENT = 'ag:experience';

export function currentExperience(): 'standard' | 'pro' {
  return currentMode() === 'pro' ? 'pro' : 'standard';
}

/** React hook: re-renders on any mode / appearance / reading change. */
export function useExperience(): {pro: boolean; mode: ModeName; appearance: Appearance; theme: 'dark' | 'light'; reading: ReturnType<typeof readingPrefs>} {
  useSyncExternalStore(subscribe, () => version, () => version);
  const appearance = currentAppearance();
  return {
    pro: isPro(),
    mode: currentMode(),
    appearance,
    theme: resolvedAppearance(appearance),
    reading: readingPrefs(),
  };
}
