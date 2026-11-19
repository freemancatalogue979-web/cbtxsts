import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// mapRecording.ts has only type imports, so it compiles on its own.
const source = await readFile(new URL("../src/lib/mapRecording.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const rec = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const editor = await readFile(new URL("../src/components/MapBoardEditor.tsx", import.meta.url), "utf8");
const engine = await readFile(new URL("../src/lib/holoEngine.ts", import.meta.url), "utf8");
const holo = await readFile(new URL("../src/components/MapHologram.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");

const hero = (id, x, y) => ({ id, hero: "Tigreal", side: "ours", x, y });
const chip = (id, x, y) => ({ id, name: "Turtle", color: "#38bdf8", size: 52, x, y, preset: "turtle" });
const board = (tokens, chips = [], paths = []) => ({ tokens, chips, paths, steps: [], zones: [] });

test("a still board adds no frames and a moving hero does", () => {
  const paths = [];
  let r = rec.startRecording("a", "Take 1", new Date("2026-10-07T00:00:00Z"));
  r = rec.addFrame(r, board([hero("h", 10, 10)], [], paths), 0);
  r = rec.addFrame(r, board([hero("h", 10, 10)], [], paths), 125);
  r = rec.addFrame(r, board([hero("h", 10, 10)], [], paths), 250);
  assert.equal(r.frames.length, 1);
  assert.equal(r.duration, 250);
  r = rec.addFrame(r, board([hero("h", 30, 40)], [], paths), 1000);
  assert.equal(r.frames.length, 2);
  assert.deepEqual(r.frames[1].p.h, [30, 40]);
  assert.equal(r.markers.h.kind, "hero");
});

test("drawings are stored once and frames point at them", () => {
  const arrow = [{ color: "#34d399", points: [[1, 1], [5, 5]], mode: "arrow" }];
  let r = rec.startRecording("a", "Take", new Date());
  r = rec.addFrame(r, board([hero("h", 1, 1)], [], []), 0);
  r = rec.addFrame(r, board([hero("h", 1, 1)], [], arrow), 500);
  r = rec.addFrame(r, board([hero("h", 2, 2)], [], [...arrow]), 900); // same content, new array
  assert.equal(r.drawings.length, 2);
  assert.deepEqual(r.frames.map((f) => f.d), [0, 1, 1]);
});

test("replay glides markers between frames and switches drawings at the frame", () => {
  let r = rec.startRecording("a", "Take", new Date());
  r = rec.addFrame(r, board([hero("h", 0, 0)], [chip("c", 50, 50)]), 0);
  r = rec.addFrame(r, board([hero("h", 0, 0)], [chip("c", 50, 50)]), 2000);
  r = rec.addFrame(r, board([hero("h", 0, 0)], [chip("c", 50, 50)], [{ color: "#fff", points: [[0, 0], [9, 9]] }]), 2100);
  r = rec.addFrame(r, board([hero("h", 60, 20)], [chip("c", 50, 50)], [{ color: "#fff", points: [[0, 0], [9, 9]] }]), 3000);
  assert.deepEqual([rec.frameAt(r, 1500).heroes[0].x, rec.frameAt(r, 1500).drawing.paths.length], [0, 0]);
  const mid = rec.frameAt(r, 2550);
  assert.ok(mid.heroes[0].x > 0 && mid.heroes[0].x < 60, "hero is part way along");
  assert.equal(mid.drawing.paths.length, 1);
  assert.deepEqual([rec.frameAt(r, 5000).heroes[0].x, rec.frameAt(r, 5000).heroes[0].y], [60, 20]);
  assert.equal(rec.frameAt(r, 2550).chips[0].preset, "turtle");
});

test("heroes removed mid-take vanish and trails follow movement", () => {
  let r = rec.startRecording("a", "Take", new Date());
  r = rec.addFrame(r, board([hero("h", 10, 10), hero("g", 90, 90)]), 0);
  r = rec.addFrame(r, board([hero("h", 20, 10)]), 1000);
  r = rec.addFrame(r, board([hero("h", 30, 10)]), 2000);
  assert.deepEqual(rec.frameAt(r, 2000).heroes.map((h) => h.id), ["h"]);
  const trail = rec.trailsAt(r, 2000).find((t) => t.id === "h");
  assert.deepEqual(trail.points[0], [10, 10]);
  assert.deepEqual(trail.points.at(-1), [30, 10]);
});

test("recordings are capped and bad saved data is ignored", () => {
  let r = rec.startRecording("a", "Take", new Date());
  r = rec.addFrame(r, board([hero("h", 1, 1)]), 0);
  const capped = rec.addFrame(r, board([hero("h", 5, 5)]), rec.REC_MAX_MS + 1);
  assert.equal(capped, r);
  assert.deepEqual(rec.cleanRecordings("nope"), []);
  assert.equal(rec.cleanRecordings([null, { id: 1 }, r]).length, 1);
  assert.equal(rec.cleanRecordings(Array.from({ length: 20 }, () => r)).length, rec.REC_MAX_TAKES);
  assert.equal(rec.fmtDuration(65_400), "1:05");
});

test("video format prefers mp4 and falls back to webm", () => {
  assert.deepEqual(rec.pickVideoType((t) => t.startsWith("video/webm")), { mime: "video/webm;codecs=vp9", ext: "webm" });
  assert.equal(rec.pickVideoType((t) => t === "video/mp4").ext, "mp4");
  assert.equal(rec.pickVideoType(() => false), null);
  assert.equal(rec.pickVideoType(() => { throw new Error("x"); }), null);
});

test("every objective preset has a 3D hologram model and three.js loads lazily", () => {
  for (const kind of ["minion", "turret", "lord", "turtle", "litho", "retribution", "\"blue-buff\"", "\"red-buff\""]) {
    assert.match(engine, new RegExp(`\\n  ${kind.replace(/[-"]/g, (c) => `\\${c}`)}: \\(m\\) =>`), kind);
  }
  assert.match(holo, /import\("\.\.\/lib\/holoEngine"\)/);
  assert.doesNotMatch(editor, /from "\.\.\/lib\/holoEngine"/, "editor must not pull three.js into the main bundle");
  assert.match(editor, /<ChipHologram preset=/);
  assert.match(css, /\.map-holo__canvas/);
});

test("chip names can be hidden for the board or per chip, and both are saved", () => {
  assert.match(editor, /\{chipNames && !c\.hideName && <span data-chip-name/);
  assert.match(editor, /aria-label="Show chip name"/);
  assert.match(editor, /showChipNames: chipNames/);
  assert.match(editor, /chipStyle: holo \? "holo" : "portrait"/);
  assert.match(editor, /recordings \}/);
});

test("replay never edits the live board", () => {
  assert.match(editor, /onPointerDown=\{replay \? undefined : onAreaDown\}/);
  assert.match(editor, /if \(!canManage \|\| replay\) return;/);
  assert.match(editor, /canManage && !replay && \(\[/);
});
