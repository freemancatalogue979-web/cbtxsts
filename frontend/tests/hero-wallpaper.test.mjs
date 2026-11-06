import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Load the real module with a stub art index, so the resolution logic is tested
// exactly as shipped.
const source = await readFile(new URL("../src/lib/heroWallpaper.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const art = new Map();
const artListeners = new Set();
const mlbbStub = {
  artFor: (name) => art.get(name),
  subscribeArt: (fn) => { artListeners.add(fn); return () => artListeners.delete(fn); },
};
const module = { exports: {} };
vm.runInNewContext(outputText, {
  module, exports: module.exports, URL,
  require: (id) => { if (id === "./mlbb") return mlbbStub; throw new Error(`unexpected import ${id}`); },
});
const W = module.exports;
const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const backdrop = await readFile(new URL("../src/components/AmbientBackdrop.tsx", import.meta.url), "utf8");

function reset() { art.clear(); W.clearSplashCache(); W.resetHdManifest(); }

test("catalogue names with spaces match our dashed slugs", () => {
  assert.deepEqual([...W.heroNameCandidates("yu-zhong")], ["yu-zhong", "yu zhong"]);
  assert.deepEqual([...W.heroNameCandidates("Atlas")], ["atlas"]);
  assert.deepEqual([...W.heroNameCandidates("  ")], []);
});

test("only https catalogue paintings are accepted", () => {
  reset();
  art.set("atlas", { art: "https://cdn.example/atlas.webp" });
  art.set("grock", { art: "http://cdn.example/grock.webp" });
  art.set("ling", { art: "javascript:alert(1)" });
  art.set("yu zhong", { art: "https://cdn.example/yz.webp" });
  assert.equal(W.officialSplash("atlas"), "https://cdn.example/atlas.webp");
  assert.equal(W.officialSplash("grock"), null);
  assert.equal(W.officialSplash("ling"), null);
  assert.equal(W.officialSplash("yu-zhong"), "https://cdn.example/yz.webp");
  assert.equal(W.officialSplash("unknown"), null);
});

test("the repo HD pack wins, but only for files the manifest lists", () => {
  reset();
  art.set("atlas", { art: "https://cdn.example/atlas.webp" });
  assert.deepEqual([...W.splashCandidates("atlas", new Set(["atlas"]))], ["/heroes/hi/atlas.webp", "https://cdn.example/atlas.webp"]);
  // No manifest entry → no blind request for a file that was never built.
  assert.deepEqual([...W.splashCandidates("atlas", new Set())], ["https://cdn.example/atlas.webp"]);
  assert.deepEqual([...W.splashCandidates("khufra", new Set())], []);
});

test("phones and offline browsers keep the bundled art", () => {
  assert.equal(W.shouldUpgradeArt({ width: 390, online: true }), false);
  assert.equal(W.shouldUpgradeArt({ width: 1023, online: true }), false);
  assert.equal(W.shouldUpgradeArt({ width: 1024, online: true }), true);
  assert.equal(W.shouldUpgradeArt({ width: 3840, online: true }), true);
  assert.equal(W.shouldUpgradeArt({ width: 3840, online: false }), false);
});

test("upgrades fall through failing sources and remember the answer", async () => {
  reset();
  art.set("atlas", { art: "https://cdn.example/atlas.webp" });
  const probed = [];
  const probe = async (url) => { probed.push(url); return url.startsWith("https://"); };
  const first = await W.resolveWallArt(["atlas", "khufra"], probe, new Set(["atlas"]));
  assert.deepEqual({ ...first }, { atlas: "https://cdn.example/atlas.webp" });
  assert.deepEqual(probed, ["/heroes/hi/atlas.webp", "https://cdn.example/atlas.webp"]);
  assert.equal(W.cachedSplash("atlas"), "https://cdn.example/atlas.webp");
  assert.equal(W.cachedSplash("khufra"), null);
  await W.resolveWallArt(["atlas", "khufra"], probe, new Set(["atlas"]));
  assert.equal(probed.length, 2, "resolved slugs are not probed again");
});

test("concurrent requests for one hero share a single probe", async () => {
  reset();
  art.set("atlas", { art: "https://cdn.example/atlas.webp" });
  let calls = 0;
  const probe = (url) => { calls++; return new Promise((done) => setTimeout(() => done(Boolean(url)), 5)); };
  await Promise.all([W.resolveWallArt(["atlas"], probe, new Set()), W.resolveWallArt(["atlas"], probe, new Set())]);
  assert.equal(calls, 1);
});

test("a hero with no art yet gets retried when the catalogue arrives", async () => {
  reset();
  const probe = async () => true;
  assert.deepEqual({ ...(await W.resolveWallArt(["valentina"], probe, new Set())) }, {});
  let notified = 0;
  const off = W.subscribeSplash(() => { notified++; });
  art.set("valentina", { art: "https://cdn.example/valentina.webp" });
  artListeners.forEach((fn) => fn());
  assert.equal(notified, 1);
  assert.deepEqual({ ...(await W.resolveWallArt(["valentina"], probe, new Set())) }, { valentina: "https://cdn.example/valentina.webp" });
  off();
});

test("a missing or broken manifest just means no HD pack", async () => {
  reset();
  assert.equal((await W.loadHdManifest(async () => ({ ok: false }))).size, 0);
  W.resetHdManifest();
  assert.equal((await W.loadHdManifest(async () => { throw new Error("offline"); })).size, 0);
  W.resetHdManifest();
  const listed = await W.loadHdManifest(async () => ({ ok: true, json: async () => ({ files: ["Atlas.webp", "yu-zhong.webp"] }) }));
  assert.deepEqual([...listed].sort(), ["atlas", "yu-zhong"]);
  W.resetHdManifest();
  assert.equal((await W.loadHdManifest(null)).size, 0);
});

test("the wallpaper never blurs or upscales hero art", () => {
  const ambient = css.slice(css.indexOf(".ambient {"), css.indexOf("@keyframes ambient-drift {"));
  assert.ok(ambient.length > 500);
  // Blur was the cause of the soft look; the art layers must not use it.
  for (const rule of ambient.matchAll(/\.ambient__(?:shelf|spotlight)[^{]*\{([^}]*)\}/g)) {
    assert.doesNotMatch(rule[1], /blur\(/, `no blur in: ${rule[0].slice(0, 60)}`);
  }
  // Bundled 240px portraits are capped at their native pixel size for the DPR.
  assert.match(ambient, /\.ambient__shelf img \{[^}]*width: clamp\([^;]*calc\(240px \/ var\(--art-dpr, 1\)\)\)/);
  assert.match(ambient, /\.ambient__spotlight\[data-art="local"\] \{ width: min\(30vw, calc\(250px \/ var\(--art-dpr, 1\)\)\); \}/);
  // HD art is shown larger, but still capped below its ~1080px source.
  assert.match(ambient, /\.ambient__spotlight\[data-art="hd"\] \{ width: min\(46vw, calc\(1000px \/ var\(--art-dpr, 1\)\)\); \}/);
  // Phones: no stretched spotlight.
  assert.match(ambient, /@media \(max-width: 767px\)[\s\S]*\.ambient__spotlight \{ display: none; \}/);
});

test("the backdrop paints local art first and publishes the DPR", () => {
  assert.match(backdrop, /node\.style\.setProperty\("--art-dpr", dpr\.toFixed\(2\)\)/);
  assert.match(backdrop, /src=\{sharp\[slug\] \?\? heroArt\(slug\)\}/);
  assert.match(backdrop, /src=\{spotlight \?\? heroArt\(theme\.spotlight\)\}/);
  assert.match(backdrop, /data-art=\{spotlight \? "hd" : "local"\}/);
  assert.match(backdrop, /referrerPolicy="no-referrer"/);
  assert.match(backdrop, /aria-hidden="true"/);
});
