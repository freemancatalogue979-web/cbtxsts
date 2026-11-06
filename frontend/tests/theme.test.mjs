import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Load the real theme module so palette and preference logic is tested, not copied.
const source = await readFile(new URL("../src/lib/theme.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const module = { exports: {} };
vm.runInNewContext(outputText, { module, exports: module.exports, require: createRequire(import.meta.url) });
const {
  ACCENTS, DEFAULT_THEME_PREFS, SECTION_THEMES, SECTIONS, THEME_STORAGE_KEYS,
  accentFor, applyTheme, heroArt, parseSection, parseThemePrefs, readThemePrefs,
  resolvedAccent, saveThemePrefs, sectionTheme,
} = module.exports;

const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const list = (value) => Array.from(value);

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

const linear = (channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16) / 255);
  return channels.reduce((sum, channel, index) => sum + linear(channel) * [0.2126, 0.7152, 0.0722][index], 0);
};
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

test("every area has its own colour and MLBB hero art", async () => {
  const sections = list(SECTIONS);
  assert.ok(sections.length >= 19);
  const accents = new Set(list(ACCENTS).map((accent) => accent.id));
  const used = new Set();
  for (const section of sections) {
    const theme = SECTION_THEMES[section];
    assert.ok(accents.has(theme.accent), `${section} uses a known accent`);
    assert.ok(theme.shelf.length >= 3, `${section} has a hero shelf`);
    used.add(theme.accent);
    for (const slug of [theme.spotlight, ...theme.shelf]) {
      // Bundled art only: no third-party CDN can break the wallpaper.
      await access(new URL(`../public/heroes/${slug}.webp`, import.meta.url));
    }
  }
  // The hub is not a two-colour app: most of the palette is in rotation.
  assert.ok(used.size >= 8, `sections only used ${used.size} accents`);
  assert.ok(new Set(sections.map((section) => SECTION_THEMES[section].spotlight)).size >= 12);
});

test("unknown routes and accents fall back safely", () => {
  assert.equal(parseSection("drafts"), "drafts");
  assert.equal(parseSection(undefined), "dashboard");
  assert.equal(parseSection("not-a-page"), "dashboard");
  assert.equal(sectionTheme("maps").accent, "emerald");
  assert.equal(sectionTheme("nonsense").accent, "crimson");
  assert.equal(accentFor("nope").id, "crimson");
});

test("accent colours stay legible on every dark surface and on filled buttons", () => {
  // Pulled from the palette in index.css so the check tracks real values.
  const surfaces = ["#070a12", "#0d121b", "#131a26", "#1a2230"].map((hex) => luminance(hex));
  for (const accent of list(ACCENTS)) {
    for (const surface of surfaces) {
      assert.ok(contrast(luminance(accent.text), surface) >= 5.5, `${accent.id} text is readable`);
    }
    assert.ok(contrast(luminance("#ffffff"), luminance(accent.solid)) >= 4.5, `${accent.id} button label`);
    assert.notEqual(accent.text, accent.solid);
  }
  // Each accent is actually wired into the stylesheet.
  for (const accent of list(ACCENTS)) {
    assert.match(css, new RegExp(`html\\[data-accent="${accent.id}"\\][^{]*\\{[^}]*--accent-solid:\\s*${accent.solid}`, "s"));
  }
});

test("the foundation is tinted blue-charcoal, never pure black", () => {
  const ink = css.match(/--color-ink:\s*#([0-9a-f]{6});/i)?.[1];
  assert.ok(ink);
  assert.notEqual(ink.toLowerCase(), "000000");
  assert.notEqual(ink.toLowerCase(), "0a0a0d");
  // A real tint, not grey: the blue channel leads.
  const [r, g, b] = [0, 2, 4].map((start) => parseInt(ink.slice(start, start + 2), 16));
  assert.ok(b > r + 6 && b > g, "foundation leans blue");
  // Cards are translucent so the hero art shows through, and the vignette is not removed.
  assert.match(css, /\.card\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--color-panel\)\s*84%,\s*transparent\)/s);
  assert.match(css, /\.ambient__vignette\s*\{/);
});

test("filled buttons and section pills follow the live accent", () => {
  const primary = css.match(/\.btn-primary\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(primary, /background:\s*var\(--accent-solid\)/);
  assert.match(primary, /color:\s*#fff/);
  const pill = css.match(/\.section-pill\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(pill, /var\(--color-crim\)/);
  assert.doesNotMatch(pill, /#965066/);
});

test("warning meaning survives a colour change", async () => {
  const ui = await readFile(new URL("../src/components/ui.tsx", import.meta.url), "utf8");
  // Errors and bad stats keep the fixed danger colour, so a pinned accent can
  // never turn a warning into a neutral highlight.
  assert.match(ui, /tone === "bad" \? "text-danger"/);
  assert.match(ui, /border-danger\/50 bg-danger\/10/);
  const danger = css.match(/--color-danger:\s*(#[0-9a-f]{6});/i)?.[1];
  assert.ok(danger);
  assert.ok(contrast(luminance(danger), luminance("#0d121b")) >= 4.5);
});

test("the wallpaper respects the backdrop, calm and reduced-motion settings", async () => {
  assert.match(css, /html\[data-backdrop="plain"\] \.ambient__stage\s*\{\s*display:\s*none/);
  assert.match(css, /html\[data-effects="calm"\] \.ambient__shelf/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.ambient__shelf[^}]*animation:\s*none/s);
  // Art is bundled locally, so no third-party image host is involved.
  assert.equal(heroArt("atlas"), "/heroes/atlas.webp");
  assert.equal(heroArt("atlas", "head"), "/heroes/head-atlas.webp");
  const backdrop = await readFile(new URL("../src/components/AmbientBackdrop.tsx", import.meta.url), "utf8");
  assert.match(backdrop, /aria-hidden="true"/);
  assert.doesNotMatch(backdrop, /https?:\/\//);
  assert.match(backdrop, /\(hover: hover\) and \(pointer: fine\)/);
});

test("auto mode follows the area; pinning one colour overrides it", () => {
  assert.equal(resolvedAccent({ ...DEFAULT_THEME_PREFS, mode: "auto" }, "ai"), "emerald");
  assert.equal(resolvedAccent({ ...DEFAULT_THEME_PREFS, mode: "auto" }, "esports"), "azure");
  assert.equal(resolvedAccent({ ...DEFAULT_THEME_PREFS, mode: "violet" }, "ai"), "violet");
  assert.equal(resolvedAccent({ ...DEFAULT_THEME_PREFS, mode: "violet" }, "not-real"), "violet");
});

test("appearance preferences default on, save only opt-outs and survive bad storage", () => {
  assert.deepEqual({ ...DEFAULT_THEME_PREFS }, { mode: "auto", backdrop: true, motion: true });
  const storage = fakeStorage();
  saveThemePrefs(storage, { mode: "auto", backdrop: true, motion: true });
  assert.equal(storage.data.size, 0, "defaults are not written");
  saveThemePrefs(storage, { mode: "amber", backdrop: false, motion: false });
  assert.equal(storage.getItem(THEME_STORAGE_KEYS.mode), "amber");
  assert.equal(storage.getItem(THEME_STORAGE_KEYS.backdrop), "off");
  assert.equal(storage.getItem(THEME_STORAGE_KEYS.motion), "calm");
  assert.deepEqual({ ...readThemePrefs(storage) }, { mode: "amber", backdrop: false, motion: false });
  saveThemePrefs(storage, { mode: "auto", backdrop: true, motion: true });
  assert.equal(storage.data.size, 0);
  assert.deepEqual({ ...parseThemePrefs({ mode: "comic-sans" }) }, { mode: "auto", backdrop: true, motion: true });
  assert.deepEqual({ ...readThemePrefs(null) }, { mode: "auto", backdrop: true, motion: true });
  assert.deepEqual({ ...readThemePrefs({ getItem() { throw new Error("blocked"); } }) }, { mode: "auto", backdrop: true, motion: true });
  assert.doesNotThrow(() => saveThemePrefs({ setItem() { throw new Error("quota"); }, removeItem() { throw new Error("quota"); } }, { mode: "lime", backdrop: true, motion: true }));
});

test("applying a theme only sets the documented data attributes", () => {
  const element = { dataset: {} };
  applyTheme({ mode: "auto", backdrop: true, motion: true }, "heroes", element);
  assert.deepEqual({ ...element.dataset }, { accent: "fuchsia", section: "heroes", backdrop: "hero", effects: "full" });
  applyTheme({ mode: "azure", backdrop: false, motion: false }, "maps", element);
  assert.deepEqual({ ...element.dataset }, { accent: "azure", section: "maps", backdrop: "plain", effects: "calm" });
  applyTheme({ mode: "azure", backdrop: true, motion: true }, "garbage", element);
  assert.equal(element.dataset.section, "dashboard");
  assert.equal(element.dataset.accent, "azure");
  assert.doesNotThrow(() => applyTheme({ mode: "auto", backdrop: true, motion: true }, "ai", null));
});

test("the document is themed before React paints, and the app keeps it in sync", async () => {
  const bootstrap = html.split("data-accent")[0] ?? "";
  const script = html.slice(html.indexOf("(function ()"), html.indexOf("</script>"));
  assert.ok(html.indexOf("clover_theme_accent") < html.indexOf("/src/main.tsx"), "theme applied before the app loads");
  assert.match(script, /root\.dataset\.accent = pinned \? stored : ACCENTS\[section\]/);
  assert.match(script, /root\.dataset\.backdrop =/);
  assert.match(script, /root\.dataset\.effects =/);

  // The bootstrap's section → accent map must match the real palette.
  const map = {};
  for (const [, section, accent] of script.matchAll(/(\w+):\s*"([a-z]+)"/g)) map[section] = accent;
  for (const section of list(SECTIONS)) {
    assert.equal(map[section], SECTION_THEMES[section].accent, `bootstrap accent for ${section}`);
  }
  assert.ok(bootstrap.length > 0);

  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /const section = user \? parseSection\(route\[0\] \|\| "dashboard"\) : "login"/);
  assert.match(app, /applyTheme\(theme, section\); saveThemePrefs\(deviceStorage\(\), theme\)/);
  assert.match(app, /theme=\{theme\} onThemeChange=\{setTheme\} section=\{section\}/);
  const layout = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /<AmbientBackdrop section=\{section\} motion=\{theme\.motion\} \/>/);
  const login = await readFile(new URL("../src/pages/Login.tsx", import.meta.url), "utf8");
  assert.match(login, /<AmbientBackdrop section="login" motion \/>/);
});

test("the profile dialog renders into the body, so blur/filter ancestors cannot crop it", async () => {
  const layout = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
  const modal = layout.slice(layout.indexOf("function ProfileModal"), layout.indexOf("function UserCard"));
  assert.match(modal, /return createPortal\(/);
  assert.match(modal, /\n    document\.body,\n\s*\);/);
  assert.doesNotMatch(modal, /return \(\n\s*<div className="fixed inset-0 z-\[60\]/);
});

test("the profile menu offers every colour plus auto, backdrop and motion", async () => {
  const layout = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /role="radiogroup" aria-label="Colour theme"/);
  assert.match(layout, /role="radio" aria-checked=\{active\} aria-label=\{option\.label\}/);
  assert.match(layout, /id: "auto", label: "Auto · follows the area"/);
  assert.match(layout, /role="switch" aria-checked=\{toggle\.value\}/);
  assert.match(layout, /aria-label="Appearance settings"/);
  assert.match(layout, /<ThemePicker theme=\{theme\} onChange=\{onThemeChange\} \/>/);
  // Swatches come from the shared palette, not from colours invented per screen.
  const picker = layout.slice(layout.indexOf("function ThemePicker"), layout.indexOf("function ProfileModal"));
  assert.match(picker, /\.\.\.ACCENTS\.map/);
  assert.match(picker, /color: accent\.text/);
});
