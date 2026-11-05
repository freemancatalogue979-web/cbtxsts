/**
 * The licensed font packs.
 *
 * Arsenica Sans is a commercial family — designed by Francesco Canovaro and
 * sold through Zetafonts — so its files are not redistributed with the app.
 *
 * The app therefore *probes* for them: drop your licensed webfont into
 * `frontend/public/fonts/arsenica-sans.woff2` (a `.woff` beside it works too)
 * and the family is registered on the next load, with no rebuild and no code
 * change. On a device without the files the probe simply fails and the font
 * stack falls through to Space Grotesk, which is bundled — no 404, no broken
 * face, and the font picker says which of the two you are actually looking at.
 */
import {useEffect, useState} from 'react';

export const ARSENICA_FAMILY = 'Arsenica Sans';

const SOURCES: {url: string; format: string}[] = [
  {url: '/fonts/arsenica-sans.woff2', format: 'woff2'},
  {url: '/fonts/arsenica-sans.woff', format: 'woff'},
];

let probe: Promise<boolean> | null = null;
const PROBE_KEY = 'arena.font.arsenica';

/**
 * Register the licensed family when its files are on this device.
 * Safe to call repeatedly: the probe only ever runs once per session.
 */
export function loadArsenicaSans(): Promise<boolean> {
  if (probe) return probe;
  probe = (async () => {
    if (typeof document === 'undefined' || !document.fonts) return false;
    /* One probe per session: a device without the licensed files should not
       pay for a failed request on every page load. */
    if (sessionStorage.getItem(PROBE_KEY) === 'miss') return false;
    for (const source of SOURCES) {
      try {
        const response = await fetch(source.url, {method: 'HEAD', cache: 'force-cache'});
        if (!response.ok) continue;
        const face = new FontFace(ARSENICA_FAMILY, `url(${source.url}) format('${source.format}')`, {
          style: 'normal',
          weight: '400 900',
          display: 'swap',
        });
        await face.load();
        document.fonts.add(face);
        sessionStorage.setItem(PROBE_KEY, 'hit');
        return true;
      } catch {
        /* no licensed file here — the stack falls through to the bundled face */
      }
    }
    sessionStorage.setItem(PROBE_KEY, 'miss');
    return false;
  })();
  return probe;
}

/**
 * Whether the licensed family is installed on this device.
 * `null` means the probe is still running.
 */
export function useArsenicaSans(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void loadArsenicaSans().then((ok) => {
      if (alive) setAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  return available;
}
