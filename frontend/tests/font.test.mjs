import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const font = await readFile(new URL("../public/fonts/CorpticDEMO-Regular.otf", import.meta.url));

// Read the font's Unicode cmap without relying on an OS-installed font or a
// font parser package. The test makes the demo's limitations explicit.
function glyphFor(codepoint) {
  const tables = font.readUInt16BE(4);
  let cmap;
  for (let i = 0; i < tables; i++) {
    const entry = 12 + i * 16;
    if (font.toString("ascii", entry, entry + 4) === "cmap") {
      cmap = font.readUInt32BE(entry + 8);
      break;
    }
  }
  assert.notEqual(cmap, undefined, "font must contain a character map");
  const subtables = font.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const start = cmap + font.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = font.readUInt16BE(start);
    if (format === 4 && codepoint <= 0xffff) {
      const count = font.readUInt16BE(start + 6) / 2;
      const ends = start + 14;
      const starts = ends + count * 2 + 2;
      const deltas = starts + count * 2;
      const offsets = deltas + count * 2;
      for (let n = 0; n < count; n++) {
        const first = font.readUInt16BE(starts + n * 2);
        const last = font.readUInt16BE(ends + n * 2);
        if (codepoint < first || codepoint > last) continue;
        const delta = font.readInt16BE(deltas + n * 2);
        const range = font.readUInt16BE(offsets + n * 2);
        if (!range) return (codepoint + delta) & 0xffff;
        const entry = offsets + n * 2 + range + (codepoint - first) * 2;
        const glyph = font.readUInt16BE(entry);
        return glyph ? (glyph + delta) & 0xffff : 0;
      }
    }
    if (format === 12) {
      const count = font.readUInt32BE(start + 12);
      for (let n = 0; n < count; n++) {
        const group = start + 16 + n * 12;
        const first = font.readUInt32BE(group);
        const last = font.readUInt32BE(group + 4);
        if (codepoint >= first && codepoint <= last) {
          return font.readUInt32BE(group + 8) + codepoint - first;
        }
      }
    }
  }
  return 0;
}

test("locally bundled Corptic DEMO is the credited Pandeka font", async () => {
  assert.equal(font.toString("ascii", 0, 4), "OTTO");
  assert.equal(createHash("sha256").update(font).digest("hex"),
    "d0ce19f1515091908cc3ef0eb2ba9a3a1904db5a990565380e58533658bf93e3");
  const license = await readFile(new URL("../public/fonts/CorpticDEMO-LICENSE.txt", import.meta.url), "utf8");
  assert.match(license, /PERSONAL USE/);
  assert.match(license, /commercial license/i);
  assert.match(license, /PandekaStudio/);
});

test("demo letters use Corptic while unavailable characters have fallbacks", () => {
  for (const character of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") {
    assert.ok(glyphFor(character.codePointAt(0)), `missing demo letter ${character}`);
  }
  for (const character of "0123456789.,!?é") {
    assert.equal(glyphFor(character.codePointAt(0)), 0, `fallback needed for ${character}`);
  }
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*"Corptic";[^}]*url\("\/fonts\/CorpticDEMO-Regular\.otf"\)/s);
  assert.match(css, /"Segoe UI Symbol"/);
  assert.match(css, /"Noto Sans Symbols"/);
  assert.match(css, /html\[data-font="corptic"\]\s*\{[^}]*--font-sans:\s*"Corptic",\s*"Montserrat Variable"/s);
});

test("digits use Montserrat even if a future Corptic face contains numbers", () => {
  const face = css.match(/@font-face\s*\{[^}]*font-family:\s*"Corptic";[^}]*}/s)?.[0] ?? "";
  const ranges = (face.match(/unicode-range:\s*([^;]+);/)?.[1] ?? "").split(",").map((part) => {
    const match = part.trim().match(/^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i);
    assert.ok(match, `invalid Unicode range: ${part}`);
    return [parseInt(match[1], 16), parseInt(match[2] ?? match[1], 16)];
  });
  const corpticCanSupply = (character) => ranges.some(([first, last]) => {
    const point = character.codePointAt(0);
    return first <= point && point <= last;
  });
  for (const digit of "0123456789") assert.equal(corpticCanSupply(digit), false, digit);
  for (const character of "AZaz .,!?é") assert.equal(corpticCanSupply(character), true, character);
  for (const name of ["sans", "mono"]) {
    const stack = css.match(new RegExp(`html\\[data-font="corptic"\\]\\s*\\{[^}]*--font-${name}:\\s*([^;]+);`))?.[1] ?? "";
    assert.match(stack, /^"Corptic",\s*"Montserrat Variable"/);
  }
});

test("Space Mono Bold is the default text style: 11px, 700 upright, 0.1em, all caps", async () => {
  const theme = css.match(/@theme\s*\{([^}]+)\}/)?.[1] ?? "";
  for (const name of ["sans", "mono"]) {
    const stack = theme.match(new RegExp(`--font-${name}:\\s*([^;]+);`))?.[1] ?? "";
    assert.match(stack, /^"Space Mono", ui-monospace,/);
    assert.match(stack, /monospace$/);
    assert.doesNotMatch(stack, /Corptic/);
  }
  const body = css.match(/\n  body\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(body, /font-size:\s*11px/);
  assert.match(body, /font-weight:\s*700/);
  assert.doesNotMatch(body, /font-style/, "Space Mono Bold is upright");
  assert.match(body, /letter-spacing:\s*0\.1em/);
  assert.match(body, /text-transform:\s*uppercase/);
  assert.doesNotMatch(body, /font-style:\s*oblique/);
  assert.doesNotMatch(body, /font-size-adjust/);
  // Typed text and placeholders follow the same case.
  assert.match(css, /input, textarea, select, button \{\s*text-transform: inherit;/);
  // The font ships with the app (no external font CDN), in the weights used.
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  // Space Mono ships with the app in its real regular and bold faces.
  assert.match(main, /import "@fontsource\/space-mono\/400\.css";/);
  assert.match(main, /import "@fontsource\/space-mono\/700\.css";/);
  assert.match(main, /import "@fontsource\/space-mono\/700-italic\.css";/);
  for (const gone of [/dm-mono/, /courier-prime/]) assert.doesNotMatch(main, gone);
  for (const gone of [/DM Mono/, /Courier/]) assert.doesNotMatch(css, gone);
});

test("Montserrat stays available as a larger, mixed-case option", () => {
  const vars = css.match(/html\[data-font="montserrat"\]\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(vars, /--font-sans:\s*"Montserrat Variable"/);
  assert.match(vars, /--font-mono:\s*"Montserrat Variable"/);
  const body = css.match(/html\[data-font="montserrat"\] body\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(body, /font-size:\s*16px/);
  assert.match(body, /font-weight:\s*600/);
  assert.match(body, /font-style:\s*normal/);
  assert.match(body, /letter-spacing:\s*0\.01em/);
  assert.match(body, /text-transform:\s*none/);
  assert.match(css, /--tracking-tight:\s*0\.01em/);
});

test("the optional Corptic style keeps its slant, readable size and thick letters", () => {
  const corptic = css.match(/html\[data-font="corptic"\] body\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(corptic, /font-style:\s*oblique/);
  assert.match(corptic, /font-weight:\s*700/);
  assert.match(corptic, /font-size-adjust:\s*0\.6/);
  assert.match(corptic, /letter-spacing:\s*0\.035em/);
  assert.match(corptic, /font-size:\s*16px/);
  assert.match(corptic, /text-transform:\s*none/);
  const base = css.match(/\n  body\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(base, /font-synthesis:\s*weight\s+style/);
  assert.match(base, /font-synthesis-weight:\s*auto/);
  assert.match(css, /@supports not \(font-size-adjust:\s*0\.6\)\s*\{\s*@font-face\s*\{[^}]*unicode-range:\s*U\+0000-002F,\s*U\+003A-10FFFF;[^}]*size-adjust:\s*120%/s);
});

test("secondary text remains clearly visible on the darkest and raised surfaces", () => {
  const color = (name) => {
    const value = css.match(new RegExp(`--color-${name}:\\s*#([0-9a-f]{6});`, "i"))?.[1];
    assert.ok(value, `${name} color must exist`);
    return [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16) / 255);
  };
  const luminance = (channels) => channels.reduce((sum, channel, index) => {
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
  const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  for (const background of ["ink", "panel", "raised", "overlay"]) {
    assert.ok(contrast(luminance(color("faint")), luminance(color(background))) >= 6.5, `faint on ${background}`);
    assert.ok(contrast(luminance(color("mute")), luminance(color(background))) >= 8, `mute on ${background}`);
  }
});

test("the mobile quick bar keeps larger, higher-contrast labels for the display font", async () => {
  const layout = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
  const bar = layout.split("{/* Mobile bottom quick bar */}")[1]?.split("</nav>")[0] ?? "";
  assert.match(bar, /text-\[10px\]/);
  // Active uses the live accent text shade (contrast-checked ≥5.5:1 in theme.test.mjs).
  assert.match(bar, /active \? "text-crim" : "text-mute"/);
  assert.match(bar, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(bar, /aria-label=\{accessibleLabel\}/);
});

test("draft cards can shrink and names can wrap on narrow screens", async () => {
  const drafts = await readFile(new URL("../src/pages/Drafts.tsx", import.meta.url), "utf8");
  assert.match(drafts, /grid grid-cols-1 gap-4/);
  assert.match(drafts, /className="min-w-0 space-y-2"/);
  assert.match(drafts, /min-w-0 break-words text-sm font-extrabold/);
});
