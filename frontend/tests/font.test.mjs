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
  for (const name of ["sans", "mono"]) {
    const stack = css.match(new RegExp(`--font-${name}:\\s*([^;]+);`))?.[1] ?? "";
    assert.match(stack, /^"Corptic",\s*"Montserrat Variable"/);
    assert.match(stack, /"Segoe UI Symbol"/);
    assert.match(stack, /"Noto Sans Symbols"/);
  }
  assert.match(css, /body\s*\{[^}]*font-style:\s*oblique/s);
});

test("the mobile quick bar keeps larger, higher-contrast labels for the display font", async () => {
  const layout = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
  const bar = layout.split("{/* Mobile bottom quick bar */}")[1]?.split("</nav>")[0] ?? "";
  assert.match(bar, /text-\[9px\]/);
  assert.match(bar, /active \? "text-rose-500" : "text-mute"/);
});
