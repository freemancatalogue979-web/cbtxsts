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
 *
 * The probe reads the file's *magic bytes* rather than trusting the response.
 * A dev server (or a host with an SPA fallback) answers a missing font with
 * `200 OK` and the HTML of the app, and a browser asked to decode that as a
 * font shouts "OTS parsing error: invalid sfntVersion" into the console. We
 * look at the first four bytes instead, so we only ever hand the browser a
 * file that really is a font — and we name the format we actually found, so a
 * WOFF that was saved with a `.woff2` name still works.
 */
import {useEffect, useState} from 'react';

export const ARSENICA_FAMILY = 'Arsenica Sans';

/**
 * Where to look, in the order we try them.
 *
 * Zetafonts ships WOFF2 and WOFF with a web licence, and the trial cut is
 * TTF — so all four containers are accepted. The format is read from the file
 * itself, not from the name, so a file called `.woff2` that is really a WOFF
 * still works.
 */
const SOURCES = [
  '/fonts/Arsenica-Sans-Variable-Roman-TRIAL.ttf',
  '/fonts/arsenica-sans.woff2',
  '/fonts/arsenica-sans.woff',
  '/fonts/arsenica-sans.ttf',
  '/fonts/arsenica-sans.otf',
];

/** What the probe found. */
export type ArsenicaStatus = 'checking' | 'ready' | 'missing' | 'unreadable';

let probe: Promise<ArsenicaStatus> | null = null;
const PROBE_KEY = 'arena.font.arsenica';
/** A miss is remembered briefly so a page load does not repeat the request. */
const MISS_TTL_MS = 60_000;

/**
 * The font container format, from the first four bytes.
 * Returns null when the bytes are not a font at all.
 */
export function sniffFontFormat(buffer: ArrayBuffer): string | null {
  if (buffer.byteLength < 4) return null;
  const bytes = new Uint8Array(buffer, 0, 4);
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'opentype';
  if (tag === 'ttcf') return 'truetype';
  if (tag === 'true' || tag === 'typ1') return 'truetype';
  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return 'truetype';
  return null;
}

/** Read a candidate and say what it is, without ever handing a non-font to the browser. */
async function inspect(url: string): Promise<{format: string; buffer: ArrayBuffer} | null> {
  const response = await fetch(url, {cache: 'force-cache'});
  if (!response.ok) return null;
  /* A server with an SPA fallback answers a missing file with the app's HTML. */
  const type = (response.headers.get('content-type') ?? '').toLowerCase();
  if (type.includes('text/html')) return null;
  const buffer = await response.arrayBuffer();
  const format = sniffFontFormat(buffer);
  return format ? {format, buffer} : null;
}

/**
 * Register the licensed family when its files are on this device.
 * Safe to call repeatedly: the probe only ever runs once at a time.
 */
export function loadArsenicaSans(): Promise<ArsenicaStatus> {
  if (probe) return probe;
  probe = (async (): Promise<ArsenicaStatus> => {
    if (typeof document === 'undefined' || !document.fonts) return 'missing';

    /* Do not trust a session-storage "hit" here. FontFace registrations do not
       survive a reload, while sessionStorage does — that old shortcut reported
       Arsenica as ready without ever adding the face to the new document. */
    const cached = sessionStorage.getItem(PROBE_KEY);
    if (cached?.startsWith('miss:')) {
      const stamp = Number(cached.slice(5));
      if (Date.now() - stamp < MISS_TTL_MS) return 'missing';
    }

    let sawFile = false;
    for (const url of SOURCES) {
      let found: {format: string; buffer: ArrayBuffer} | null = null;
      try {
        found = await inspect(url);
      } catch {
        continue;
      }
      if (!found) continue;
      sawFile = true;
      try {
        const face = new FontFace(ARSENICA_FAMILY, `url(${url}) format('${found.format}')`, {
          style: 'normal',
          weight: '400 900',
          display: 'swap',
        });
        await face.load();
        document.fonts.add(face);
        sessionStorage.setItem(PROBE_KEY, 'hit');
        return 'ready';
      } catch {
        /* The bytes looked like a font but the browser would not take them —
           try the other candidate before giving up. */
      }
    }

    /* A file was there but unreadable: say so, rather than blaming the licence. */
    const status: ArsenicaStatus = sawFile ? 'unreadable' : 'missing';
    sessionStorage.setItem(PROBE_KEY, `miss:${Date.now()}`);
    return status;
  })();
  return probe;
}

/**
 * Whether the licensed family is installed on this device.
 * `checking` means the probe is still running.
 */
export function useArsenicaSans(): ArsenicaStatus {
  const [status, setStatus] = useState<ArsenicaStatus>('checking');
  useEffect(() => {
    let alive = true;
    void loadArsenicaSans().then((result) => {
      if (alive) setStatus(result);
    });
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

/** Forget a cached probe so the next call looks again. */
export function resetArsenicaProbe(): void {
  probe = null;
  sessionStorage.removeItem(PROBE_KEY);
}
