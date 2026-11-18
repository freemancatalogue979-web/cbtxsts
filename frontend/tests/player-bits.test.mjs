import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
async function load(path, local = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const module = { exports: {} };
  const require = (id) => (id in local ? local[id] : nodeRequire(id));
  vm.runInNewContext(outputText, { module, exports: module.exports, require });
  return module.exports;
}

const caseText = await load("../src/lib/caseText.ts");
const ui = await load("../src/components/ui.tsx");
const bits = await load("../src/components/PlayerBits.tsx", { "../lib/caseText": caseText, "./ui": ui });
const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const html = (type, props) => renderToStaticMarkup(React.createElement(type, props));

test("a member chip shows face, the exact IGN and a lane-coloured tag", () => {
  const out = html(bits.PlayerChip, { user: { ign: "ᴋαмɪɴαʀɪ⚝", name: "Dre", main_role: "JUNGLE" } });
  assert.match(out, /^<span class="player-chip " data-lane="JUNGLE" title="Dre · Jungle">/);
  assert.match(out, /<span class="player-chip__face" aria-hidden="true"><span class="ign">ᴋ<\/span><\/span>/);
  assert.match(out, /<span class="player-chip__name"><bdi class="ign" dir="auto">ᴋαмɪɴαʀɪ⚝<\/bdi><\/span>/);
  assert.match(out, /<span class="player-chip__lane">Jungle<\/span>/);
  // No lane → no lane tag and no lane colour.
  const plain = html(bits.PlayerChip, { user: { ign: "Pip", name: "Pip Lan" } });
  assert.doesNotMatch(plain, /data-lane|player-chip__lane/);
});

test("lane aliases map onto the five lane colours", () => {
  assert.equal(bits.laneKey("Jgl"), "JUNGLE");
  assert.equal(bits.laneKey("roamer"), "ROAM");
  assert.equal(bits.laneKey("gold"), "GOLD");
  assert.equal(bits.laneKey("Coach"), "");
  for (const lane of ["EXP", "JUNGLE", "MID", "GOLD", "ROAM"]) assert.match(css, new RegExp(`html \\[data-lane="${lane}"\\] \\{ --lane: #`));
});

test("win ring and meter read out their values and handle missing data", () => {
  assert.match(html(bits.WinRing, { value: 60 }), /role="img" aria-label="Series win rate 60%"/);
  assert.match(html(bits.WinRing, { value: 60 }), /--ring:var\(--color-leaf\)/);
  assert.match(html(bits.WinRing, { value: 30 }), /--ring:var\(--color-danger\)/);
  assert.match(html(bits.WinRing, { value: null }), /aria-label="No series yet"/);
  assert.match(html(bits.Meter, { value: 7.5, label: "Average confidence" }), /aria-label="Average confidence 7.5 out of 10".*width:75%/);
  assert.match(html(bits.Meter, { value: null, label: "Average confidence" }), /not rated yet/);
});

test("chips tint themselves from their own colour; roster and scrim rows use the new cards", async () => {
  assert.match(css, /\.chip \{[^}]*border-color: color-mix\(in srgb, currentColor 32%, var\(--color-edge\)\);/s);
  const players = await readFile(new URL("../src/pages/Players.tsx", import.meta.url), "utf8");
  assert.match(players, /<RosterCard key=\{p\.id\}/);
  assert.match(players, /<WinRing value=\{played \? stats\?\.win_rate : null\} \/>/);
  const scrims = await readFile(new URL("../src/pages/Scrims.tsx", import.meta.url), "utf8");
  assert.match(scrims, /className="w-full text-left card card-hover scrim-row"/);
  assert.match(scrims, /<b>\{s\.score_us\}<\/b><i>–<\/i><b>\{s\.score_them\}<\/b>/);
  const training = await readFile(new URL("../src/pages/Training.tsx", import.meta.url), "utf8");
  assert.equal((training.match(/<PlayerChip key=\{u\.id\} user=\{u\} \/>/g) ?? []).length, 2);
});
