/**
 * Theme audit — the daylight skin makes "hard-coded white" a bug.
 *
 * The arena ships two skins off one markup tree: the night skin (ink surfaces,
 * light type) and the daylight skin (paper surfaces, dark type). Token classes
 * survive both because the skin re-maps them, but a literal white does not: on
 * paper it is invisible. This script reads the JSX and flags the literals that
 * only work in the dark, so the regression cannot come back quietly.
 *
 *   node scripts/theme-audit.mjs
 *
 * Rules:
 *   1. `text-white` (or `text-white/N`) on an element with no coloured or
 *      gradient backdrop — white type straight onto a page surface.
 *   2. Hard-coded near-white colours in classNames or inline styles.
 *   3. Colour utilities on accent steps the theme does not define, which
 *      Tailwind drops silently (the element then inherits its parent's colour).
 */
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SRC = join(ROOT, 'src');
const FAMILIES = ['nova', 'flare', 'pulse', 'mint', 'gold'];
const issues = [];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(tsx|ts)$/.test(entry) ? [full] : [];
  });
}

/* ------------------------------------------- 3. colour steps nobody declared */
// A utility whose step is not declared still gets generated — Tailwind falls
// back to a default ramp value. That is how `text-mist-100` ended up painting
// near-white (96% lightness) text on paper: the class existed, the declaration
// did not, so it never flipped with the skin.
const css = readFileSync(join(SRC, 'index.css'), 'utf8');
const declared = new Set();
for (const match of css.matchAll(/--(?:color|qa)-([a-z]+)-(\d{2,3}):/g)) declared.add(`${match[1]}-${match[2]}`);

for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const rel = relative(ROOT, file);

  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\b(?:text|bg|border|from|to|via|ring|fill|stroke|shadow)-(nova|flare|pulse|mint|gold|mist|ink)-(\d{2,3})\b/g)) {
      const key = `${match[1]}-${match[2]}`;
      if (!declared.has(key)) {
        issues.push(`${rel}:${index + 1} “${key}” has no declaration in index.css — Tailwind substitutes a default ramp value that never flips with the skin`);
      }
    }
  });

  /* ------------------------------------------ 2. literal near-white colours */
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    // Party confetti is deliberately multicoloured and includes white flakes.
    if (/lib\/confetti\.ts$/.test(rel)) return;
    for (const match of line.matchAll(/#(?:fff(?:fff)?|f6f7ff|f8f9ff|ffffff)\b/gi)) {
      const around = line.slice(Math.max(0, match.index - 60), match.index + 60);
      // Shadows and inset highlights are decoration, not type.
      if (/shadow-|inset|drop-shadow|confetti|BRAND_COLORS|dots:|particle|flake/i.test(around)) continue;
      issues.push(`${rel}:${index + 1} hard-coded white ${match[0]} — it disappears on the daylight skin (${around.trim().slice(0, 70)})`);
    }
  });

  /* --------------------------------- 1. white type without a colour behind it */
  // Walk the element a `text-white` belongs to, then a few ancestors, looking
  // for something that paints a saturated background.
  const coloured = /gradient|brand-gradient|bg-(?:nova|flare|pulse|mint|gold|rose|amber)-(?:4|5|6|7)\d0|keep-dark|map-node|gbtn-primary|score-pop/;
  lines.forEach((line, index) => {
    if (!/\btext-white(?:\/\d+)?\b/.test(line)) return;
    if (/\bkeep-dark\b/.test(line)) return;
    if (/\btheme-ok\b/.test(line)) return;
    if (coloured.test(line)) return;
    // The backdrop is often a sibling pill (a layoutId <motion.span> sitting
    // just under the label) rather than an ancestor, so look a little wider
    // before complaining.
    const window = lines.slice(Math.max(0, index - 10), index + 8).join('\n');
    if (coloured.test(window)) return;
    issues.push(`${rel}:${index + 1} \`text-white\` with no coloured backdrop — invisible on paper; use a token (text-mist-50) or a gradient`);
  });
}

const unique = [...new Set(issues)];
if (unique.length === 0) {
  console.log('theme-audit: clean — no white-on-paper type, no undefined accent steps');
} else {
  console.log(`theme-audit: ${unique.length} issue(s)`);
  for (const issue of unique) console.log(` - ${issue}`);
}
process.exit(unique.length === 0 ? 0 : 1);
