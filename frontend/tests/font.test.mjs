import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");

test("Montserrat Bold is the only text style: 11px, 700 upright, 0.1em, all caps", async () => {
  const theme = css.match(/@theme\s*\{([^}]+)\}/)?.[1] ?? "";
  for (const name of ["sans", "mono"]) {
    const stack = theme.match(new RegExp(`--font-${name}:\\s*([^;]+);`))?.[1] ?? "";
    assert.match(stack, /^"Montserrat Variable", "Helvetica Neue",/);
    assert.match(stack, /"Noto Sans Symbols"/, "symbol fallback for stylised names");
    assert.match(stack, /sans-serif$/);
  }
  const body = css.match(/\n  body\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(body, /font-size:\s*11px/);
  assert.match(body, /font-weight:\s*700/);
  assert.doesNotMatch(body, /font-style/, "Montserrat Bold is upright");
  assert.match(body, /letter-spacing:\s*0\.1em/);
  assert.match(body, /text-transform:\s*uppercase/);
  assert.match(css, /--tracking-tight:\s*0\.01em/);
  // Typed text and placeholders follow the same case.
  assert.match(css, /input, textarea, select, button \{\s*text-transform: inherit;/);
  // Montserrat ships with the app (no external font CDN) as a variable font.
  assert.match(main, /import "@fontsource-variable\/montserrat";/);
  const face = await readFile(new URL("../node_modules/@fontsource-variable/montserrat/index.css", import.meta.url), "utf8");
  assert.match(face, /font-family: 'Montserrat Variable'/);
  assert.match(face, /font-weight: 100 900/);
});

test("the other fonts and the font menu are gone", async () => {
  for (const gone of [/Corptic/i, /Space Grotesk/, /Space Mono/, /DM Mono/, /Courier/, /data-font/]) assert.doesNotMatch(css, gone);
  for (const gone of [/space-grotesk/, /space-mono/, /dm-mono/, /courier-prime/]) assert.doesNotMatch(main, gone);
  const pkg = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(pkg, /space-grotesk|space-mono|courier-prime|dm-mono/);
  const layout = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /FontPicker|FontChoice|[Tt]ext style/);
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /fontPrefs|FontChoice/);
  for (const file of ["../src/lib/fontPrefs.ts", "../public/fonts/CorpticDEMO-Regular.otf", "../public/fonts/CorpticDEMO-LICENSE.txt"]) {
    await assert.rejects(access(new URL(file, import.meta.url)), `${file} should be deleted`);
  }
  // Old saved choices are cleared before the first paint; nothing sets data-font.
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /localStorage\.removeItem\("clover_font_choice"\)/);
  assert.doesNotMatch(html, /dataset\.font/);
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

test("the mobile quick bar keeps larger, higher-contrast labels", async () => {
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
