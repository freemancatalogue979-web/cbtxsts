import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");

test("Courier New Bold is the only text style: 11px, 900 italic, 0.1em, never all caps", async () => {
  const theme = css.match(/@theme\s*\{([^}]+)\}/)?.[1] ?? "";
  for (const name of ["sans", "mono"]) {
    const stack = theme.match(new RegExp(`--font-${name}:\\s*([^;]+);`))?.[1] ?? "";
    // Courier New first; Courier Prime is the bundled stand-in for phones without it.
    assert.match(stack, /^"Courier New", Courier, "Courier Prime",/);
    assert.doesNotMatch(stack, /Courier Std/);
    assert.match(stack, /"Noto Sans Symbols"/, "symbol fallback for stylised names");
    assert.match(stack, /monospace$/);
  }
  const body = css.match(/\n  body\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(body, /font-size:\s*11px/);
  assert.match(body, /font-weight:\s*900/);
  assert.match(body, /font-style:\s*italic/);
  assert.doesNotMatch(body, /oblique/, "a real italic face, not a synthetic slant");
  assert.match(body, /-webkit-text-stroke-width:\s*0\.02em/, "Courier tops out at Bold, so a hairline stroke gives the 900 weight");
  assert.match(body, /letter-spacing:\s*0\.1em/);
  assert.doesNotMatch(body, /text-transform/);
  assert.match(css, /--tracking-tight:\s*0\.01em/);
  // The bold italic face ships with the app (no external font CDN).
  assert.match(main, /import "@fontsource\/courier-prime\/700-italic\.css";/);
  const face = await readFile(new URL("../node_modules/@fontsource/courier-prime/700-italic.css", import.meta.url), "utf8");
  assert.match(face, /font-family: 'Courier Prime'/);
  assert.match(face, /font-style: italic/);
  assert.match(face, /font-weight: 700/);
});

test("nothing is displayed in all caps", async () => {
  // A global guard beats any stray all-caps rule, including placeholders and pseudo-elements.
  assert.match(css, /\*, \*::before, \*::after, ::placeholder \{\s*text-transform: none !important;/);
  const { readdir } = await import("node:fs/promises");
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) await walk(url);
      else if (/\.(tsx?|css)$/.test(entry.name)) files.push(url);
    }
  };
  await walk(new URL("../src/", import.meta.url));
  // Built from pieces so Tailwind's source scanner doesn't generate the utility from this test.
  const UP = "upper" + "case";
  for (const file of files) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, new RegExp(`text-transform:\\s*${UP}`), `${file.pathname} shouts text`);
    assert.doesNotMatch(text, new RegExp(`className=[^>]*\\b${UP}\\b`), `${file.pathname} uses the caps utility`);
    assert.doesNotMatch(text, new RegExp(`@apply[^;]*\\b${UP}\\b`), `${file.pathname} applies the caps utility`);
  }
  // Inputs keep what the member typed.
  for (const page of ["Admin", "Archive", "Training"]) {
    const source = await readFile(new URL(`../src/pages/${page}.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /e\.target\.value\.toUpperCase\(\)/, `${page} forces typed text to caps`);
  }
});

test("stored enums are shown in normal case while acronyms stay", async () => {
  const ts = (await import("typescript")).default;
  const source = await readFile(new URL("../src/lib/caseText.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  const { nice } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
  assert.equal(nice("JUNGLE"), "Jungle");
  assert.equal(nice("BANNED/RESTRICTED"), "Banned/restricted");
  assert.equal(nice("OPPONENT FILE"), "Opponent file");
  assert.equal(nice("WIN"), "Win");
  assert.equal(nice("EXP"), "EXP");
  assert.equal(nice("MLBB MATCH REVIEW"), "MLBB match review");
  assert.equal(nice("Kagura ⚝"), "Kagura ⚝", "already-friendly text is untouched");
  assert.equal(nice(null), "");
});

test("the other fonts and the font menu are gone (Montserrat only for in-game names)", async () => {
  for (const gone of [/Corptic/i, /Space Grotesk/, /Space Mono/, /DM Mono/, /data-font/]) assert.doesNotMatch(css, gone);
  for (const gone of [/space-grotesk/, /space-mono/, /dm-mono/]) assert.doesNotMatch(main, gone);
  // Montserrat appears in the IGN rule only, never in the body/heading stacks.
  const theme = css.match(/@theme\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.doesNotMatch(theme, /Montserrat/);
  assert.equal((css.match(/"Montserrat Variable"/g) ?? []).length, 1);
  const pkg = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(pkg, /space-grotesk|space-mono|dm-mono/);
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
