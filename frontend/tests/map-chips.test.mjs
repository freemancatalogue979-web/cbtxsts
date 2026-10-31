import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// The pure TypeScript module has only type imports. Compile it in memory using
// the existing TypeScript dev dependency, so these tests need no browser.
const source = await readFile(new URL("../src/lib/mapChips.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { CHIP_PRESETS, chipPreset, chipSpawnPoint } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

function inFrame(point, frame, surface) {
  const x = surface.left + surface.width * point.x / 100;
  const y = surface.top + surface.height * point.y / 100;
  return x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom;
}

test("six presets have locally bundled WebP portraits", async () => {
  assert.deepEqual(CHIP_PRESETS.map((p) => p.id), ["litho", "minion", "turret", "retribution", "lord", "turtle"]);
  for (const preset of CHIP_PRESETS) {
    const image = await readFile(new URL(`../public/map-chips/${preset.id}.webp`, import.meta.url));
    assert.equal(image.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(image.subarray(8, 12).toString("ascii"), "WEBP");
  }
});

test("legacy aliases get portraits and explicit preset survives a rename", () => {
  for (const [name, id] of [["Lithowanderer", "litho"], ["MINIONS", "minion"], ["Turrets", "turret"], ["Retri", "retribution"], ["Lord", "lord"], [" Turtle ", "turtle"]]) {
    assert.equal(chipPreset({ name })?.id, id);
  }
  assert.equal(chipPreset({ name: "River scout", preset: "litho" })?.id, "litho");
  assert.equal(chipPreset({ name: "Custom callout" }), undefined);
});

test("one-click spawn stays visible and staggers repeated chips", () => {
  const frame = rect(20, 40, 780, 350), surface = frame, occupied = [];
  for (let i = 0; i < 6; i++) {
    const point = chipSpawnPoint(frame, surface, 52, 1, occupied);
    assert(inFrame(point, frame, surface));
    assert(!occupied.some((other) => other.x === point.x && other.y === point.y));
    occupied.push({ ...point, size: 52 });
  }
});

test("spawn uses the visible viewport after zoom and pan", () => {
  const frame = rect(100, 100, 400, 180), surface = rect(-50, 40, 800, 360);
  const point = chipSpawnPoint(frame, surface, 52, 2, []);
  assert.deepEqual(point, { x: 43.8, y: 41.7 });
  assert(inFrame(point, frame, surface));
});

test("small maps and oversized chips still spawn within the frame", () => {
  const frame = rect(10, 20, 260, 117), occupied = [];
  for (let i = 0; i < 6; i++) {
    const point = chipSpawnPoint(frame, frame, 52, 1, occupied);
    assert(inFrame(point, frame, frame));
    assert(!occupied.some((other) => other.x === point.x && other.y === point.y));
    occupied.push({ ...point, size: 52 });
  }
  assert(inFrame(chipSpawnPoint(frame, frame, 112, 1, []), frame, frame));
  assert.deepEqual(chipSpawnPoint(undefined, undefined, 52, 1, []), { x: 50, y: 50 });
});
