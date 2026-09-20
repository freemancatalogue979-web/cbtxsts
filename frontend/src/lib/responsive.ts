/**
 * Viewport helpers. Most players are on phones, so screens that need a physical
 * size (progress rings, avatars) ask here instead of hard-coding pixels.
 */
import {useEffect, useState} from 'react';

function read(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** Tracks a media query, re-rendering when it flips (safe in jsdom/SSR). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    let list: MediaQueryList;
    try {
      list = window.matchMedia(query);
    } catch {
      return undefined;
    }
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    }
    // Safari < 14
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }, [query]);

  return matches;
}

/** Phone-sized viewport (matches Tailwind's default `sm` breakpoint). */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 639px)');
}

/** Very small phones (iPhone SE, older Androids) — tighten further. */
export function useIsNarrow(): boolean {
  return useMediaQuery('(max-width: 379px)');
}

/** Touch device without a real hover state — skip hover-only affordances. */
export function useIsTouch(): boolean {
  return useMediaQuery('(hover: none), (pointer: coarse)');
}

/** Pick a pixel size for rings/avatars based on the viewport. */
export function useSize(mobile: number, desktop: number): number {
  return useIsMobile() ? mobile : desktop;
}
