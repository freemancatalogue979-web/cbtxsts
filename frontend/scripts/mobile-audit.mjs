/**
 * Mobile layout audit — static scan of the UI source for the patterns that
 * break a 360px-wide phone. No browser needed: it reads the JSX and flags
 * anything that cannot shrink, hides text behind an iOS zoom, or squeezes a
 * grid into unreadable columns.
 *
 *   node scripts/mobile-audit.mjs
 */
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

const VIEWPORT = 360; // smallest phone we promise to support
const issues = [];
const files = []; // [relative path, source] pairs for whole-file checks

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) yieldFile(full);
  }
}

function yieldFile(file) {
  const where = relative(ROOT, file);
  const source = readFileSync(file, 'utf8');
  files.push([where, source]);
  const lines = source.split('\n');

  lines.forEach((line, i) => {
    const at = `${where}:${i + 1}`;

    // 1. Fixed widths that cannot fit a 360px viewport (min-w / w, not max-w).
    for (const match of line.matchAll(/(?<!max-)\b(?:min-)?w-\[(\d+(?:\.\d+)?)px\]/g)) {
      const px = Number(match[1]);
      if (px > VIEWPORT - 24) issues.push(`${at} fixed width ${px}px exceeds a ${VIEWPORT}px phone`);
    }

    // 2. Input text size is checked once, on the shared CONTROL constant, below.

    // 3. Grids with 3+ columns and no responsive escape hatch get unreadable on phones.
    for (const match of line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const classes = match[1] || match[2] || '';
      // Three-up stat rows are a deliberate phone pattern (compact + truncated);
      // four or more columns cannot stay legible on 360px without a breakpoint.
      const bare = [...classes.matchAll(/(?<![a-z-])grid-cols-(\d+)/g)].filter((m) => Number(m[1]) >= 4);
      const responsive = /(?:sm|md|lg|xl):grid-cols-/.test(classes) || /grid-cols-\d+\s+(?:sm|md|lg|xl):/.test(classes);
      const preceded = /(?:sm|md|lg|xl):grid-cols-\d+/.test(classes);
      if (bare.length && !preceded && !responsive) {
        issues.push(`${at} grid-cols-${bare[0][1]} with no responsive variant`);
      }
      // 4. Anything allowed to grow past the viewport.
      if (/\bmin-w-\[(\d+)px\]/.test(classes) && Number(classes.match(/\bmin-w-\[(\d+)px\]/)[1]) > VIEWPORT - 24) {
        issues.push(`${at} min-width larger than a phone`);
      }
    }

    // 5. Wide tables must sit in a horizontal scroller (look back a few lines).
    if (/<table/.test(line) && /min-w-\[/.test(line)) {
      const context = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
      if (!context.includes('overflow-x-auto')) issues.push(`${at} wide <table> without an overflow-x-auto wrapper`);
    }
  });
}

walk(SRC);

// The shared input control must keep 16px text on phones.
const ui = readFileSync(join(SRC, 'components/ui.tsx'), 'utf8');
const control = (ui.match(/const CONTROL =\s*([\s\S]*?);\n/)?.[1] ?? '').replace(/\/\/[^\n]*/g, '');
if (!/text-base/.test(control)) issues.push('src/components/ui.tsx CONTROL is missing text-base (iOS zooms inputs under 16px)');
// Responsive horizontal padding on CONTROL would outrank the pl-* that icon
// prefixed fields use (breakpoint variants sort after base utilities), sliding
// typed text underneath the icon.
if (/sm:px-|md:px-|lg:px-/.test(control)) {
  issues.push('src/components/ui.tsx CONTROL uses responsive horizontal padding, which overrides icon-field left padding');
}
// Any input that pads for an icon must keep that pad at every breakpoint.
for (const [file, source] of files) {
  for (const match of source.matchAll(/className="([^"]*\bpl-(?:\d+|\[[^\]]+\])[^"]*)"/g)) {
    const classes = match[1];
    if (/sm:px-|md:px-|lg:px-/.test(classes)) {
      issues.push(`${file}: input left padding can be overridden by a responsive px-* (${classes.slice(0, 60)})`);
    }
  }
}

// Bottom tab bar must be a real touch target.
const shell = readFileSync(join(SRC, 'components/AppShell.tsx'), 'utf8');
if (!/min-h-14/.test(shell)) issues.push('src/components/AppShell.tsx bottom tabs are under 44px tall');
if (!/safe-area-inset-bottom/.test(shell)) issues.push('src/components/AppShell.tsx bottom bar ignores the home-indicator inset');

/* ------------------------------------------------------------- fixed viewport
   The arena ships at one scale. A phone that can pinch its way into a different
   layout is not the app we tested, so the lock has to be in all three layers:
   the meta tag (Android), the body rule (iOS 13+ / Chrome) and the gesture
   guard (older iOS Safari, desktop ctrl+wheel and ctrl +/- zoom). */
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const viewport = indexHtml.match(/<meta name="viewport"[^>]*>/)?.[0] ?? '';
if (!/maximum-scale=1/.test(viewport) || !/user-scalable=no/.test(viewport)) {
  issues.push('index.html viewport does not lock the scale (needs maximum-scale=1 and user-scalable=no)');
}
const css = readFileSync(join(SRC, 'index.css'), 'utf8');
if (!/touch-action:\s*pan-x pan-y/.test(css)) {
  issues.push('src/index.css body is missing `touch-action: pan-x pan-y` — pinch and double-tap zoom survive');
}
if (!/text-size-adjust:\s*100%/.test(css)) {
  issues.push('src/index.css is missing text-size-adjust: 100% — phones may inflate type and break the layout');
}
const mainSrc = readFileSync(join(SRC, 'main.tsx'), 'utf8');
if (!/lockViewport\(\)/.test(mainSrc)) {
  issues.push('src/main.tsx never calls lockViewport() — iOS Safari and desktop ctrl+wheel zoom stay open');
}
if (!existsSync(join(SRC, 'lib/zoomlock.ts'))) {
  issues.push('src/lib/zoomlock.ts is missing');
}

/* ---------------------------------------------------------------- copy length
   Phones get short option copy. Every "blurb" that renders inside a picker card
   must carry a "short" twin, and the card must render through OptionBlurb rather
   than dropping the full desktop blurb onto a 360px screen. */
const prefs = readFileSync(join(SRC, 'lib/prefs.ts'), 'utf8');
for (const group of ['THEMES', 'MASCOTS', 'MODES', 'FONTS', 'SKINS']) {
  const start = prefs.indexOf(`export const ${group}`);
  const end = prefs.indexOf('\n];', start);
  const block = start === -1 || end === -1 ? '' : prefs.slice(start, end);
  const blurbs = (block.match(/blurb:/g) || []).length;
  const shorts = (block.match(/short:/g) || []).length;
  if (blurbs === 0) issues.push(`src/lib/prefs.ts ${group} was not found — the short-copy check is blind`);
  else if (blurbs !== shorts) issues.push(`src/lib/prefs.ts ${group} has ${blurbs} blurbs but ${shorts} short lines — a phone would read the long one`);
}
const musicSrc = readFileSync(join(SRC, 'lib/music.ts'), 'utf8');
const trackBlock = musicSrc.slice(musicSrc.indexOf('export const MUSIC_TRACKS'), musicSrc.indexOf('function currentTrack'));
{
  const blurbs = (trackBlock.match(/blurb:/g) || []).length;
  const shorts = (trackBlock.match(/short:/g) || []).length;
  if (blurbs !== shorts) issues.push(`src/lib/music.ts has ${blurbs} track blurbs but ${shorts} short lines`);
}
const profileSrc = readFileSync(join(SRC, 'panels/ProfilePanel.tsx'), 'utf8');
if (!profileSrc.includes('function OptionBlurb')) issues.push('src/panels/ProfilePanel.tsx lost its OptionBlurb component');
const rawBlurbs = profileSrc.match(/>\{option\.blurb\}</g) || [];
const rawTracks = profileSrc.match(/>\{track\.blurb\}</g) || [];
const cards = profileSrc.match(/<OptionBlurb /g) || [];
if (rawBlurbs.length || rawTracks.length) {
  issues.push(`src/panels/ProfilePanel.tsx renders ${rawBlurbs.length + rawTracks.length} full blurb(s) straight into a card — phones must get the short line`);
}
if (cards.length < 6) issues.push(`src/panels/ProfilePanel.tsx routes only ${cards.length} card(s) through OptionBlurb`);

const unique = [...new Set(issues)];
if (unique.length === 0) {
  console.log(`mobile-audit: 0 issues across ${countFiles()} files — every screen fits a ${VIEWPORT}px phone`);
  process.exit(0);
}
console.log(`mobile-audit: ${unique.length} issue(s)`);
unique.forEach((line) => console.log(` - ${line}`));
process.exit(1);

function countFiles() {
  let n = 0;
  const step = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) step(full);
      else if (full.endsWith('.tsx')) n += 1;
    }
  };
  step(SRC);
  return n;
}
