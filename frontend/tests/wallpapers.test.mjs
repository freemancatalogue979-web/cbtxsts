import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

// Bundle the real module with a stub API so the choice/mix logic is tested, not copied.
const out = await build({
  stdin: { contents: 'export * from "./src/lib/wallpapers.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "neutral",
  external: ["react"],
  plugins: [{ name: "stub-api", setup(b) { b.onResolve({ filter: /\/api$/ }, () => ({ path: "api", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const api = { get: async () => ({ items: [] }) };", loader: "js" })); } }],
});
const url = "data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text.replace(/from\s*"react"/g, 'from "data:text/javascript,export const useEffect=()=>{},useState=()=>[],useSyncExternalStore=()=>{}"')).toString("base64");
const { parseChoice, wallpaperFor, setWallpaperChoice, getWallpaperChoice, subscribeWallpaper } = await import(url);

const items = ["a1", "b2", "c3", "d4"].map((id) => ({ id, title: "", heroes: [], desktop: `/d/${id}`, mobile: `/m/${id}`, thumb: `/t/${id}`, local: true }));

test("choices are validated: hero art, mix or a wallpaper id", () => {
  assert.equal(parseChoice("mix"), "mix");
  assert.equal(parseChoice("3503336"), "3503336");
  for (const bad of [null, 5, "../x", "<script>", "A".repeat(3)]) assert.equal(parseChoice(bad), "");
});

test("one wallpaper everywhere, mix is stable per area, login never gets one", () => {
  assert.equal(wallpaperFor(items, "", "scrims"), null);
  assert.equal(wallpaperFor(items, "c3", "scrims").id, "c3");
  assert.equal(wallpaperFor(items, "gone", "scrims"), null);
  const scrims = wallpaperFor(items, "mix", "scrims");
  assert.equal(wallpaperFor(items, "mix", "scrims"), scrims);
  const picked = new Set(["dashboard", "scrims", "tournaments", "heroes", "drafts", "utility", "players"].map((s) => wallpaperFor(items, "mix", s).id));
  assert.ok(picked.size >= 2, "areas differ in mix");
  assert.equal(wallpaperFor(items, "mix", "login"), null);
  assert.equal(wallpaperFor([], "mix", "scrims"), null);
});

test("changing the choice notifies the backdrop", () => {
  let calls = 0;
  const stop = subscribeWallpaper(() => calls++);
  setWallpaperChoice("b2");
  assert.equal(getWallpaperChoice(), "b2");
  setWallpaperChoice("../evil");
  assert.equal(getWallpaperChoice(), "");
  stop();
  assert.equal(calls, 2);
});

test("backdrop and picker are wired, honour calm/reduced motion and stay readable on phones", async () => {
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  const backdrop = await readFile(new URL("../src/components/AmbientBackdrop.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
  assert.match(backdrop, /const wall = useWallpaper\(section\)/);
  assert.match(backdrop, /media="\(max-width: 767px\) and \(orientation: portrait\)" srcSet=\{wall\.mobile\}/);
  assert.match(css, /\.ambient--wallpaper \.ambient__shelf,\s*\.ambient--wallpaper \.ambient__spotlight \{ display: none; \}/);
  assert.match(css, /html\[data-effects="calm"\] \.ambient__wallpaper \{ animation: none; \}/);
  assert.match(css, /prefers-reduced-motion[^}]*\.ambient__wallpaper \{ animation: none; \}/s);
  assert.match(css, /max-width: 767px[\s\S]*\.ambient__wallpaper img \{ opacity: 0\.42; \}/);
  assert.match(layout, /<WallpaperPicker admin=\{user\.role === "admin"\}/);
  assert.match(layout, /role="radiogroup" aria-label="Wallpaper"/);
  assert.match(layout, /grid grid-cols-3 sm:grid-cols-4/);
});

test("hero pictures: bundled pack first, then the server's official copy, then Rone", async () => {
  const img = await readFile(new URL("../src/components/HeroImg.tsx", import.meta.url), "utf8");
  const draft = await readFile(new URL("../src/components/DraftBoard.tsx", import.meta.url), "utf8");
  const mlbb = await readFile(new URL("../src/lib/mlbb.ts", import.meta.url), "utf8");
  assert.match(mlbb, /`\/api\/heroes\/art\/\$\{encodeURIComponent\(heroSlug\(name\)\)\}\/\$\{kind\}`/);
  assert.match(img, /\[heroArt\(name\), heroOfficial\(name, "smallmap"\), remote\?\.art\]/);
  assert.match(img, /\[heroHead\(name\), heroOfficial\(name, "head"\), remote\?\.head\]/);
  assert.equal((draft.match(/heroOfficial\(name!, "(head|smallmap)"\)/g) ?? []).length, 3);
});
