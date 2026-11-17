import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const source = await read("../src/lib/api.ts");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });

test("a delete response with X-Clover-Trash fires the Undo event; other responses don't", async () => {
  const fired = [];
  globalThis.window = {
    dispatchEvent: (e) => fired.push(e),
    setTimeout, clearTimeout,
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.CustomEvent = class extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } };
  const replies = [
    new Response(null, { status: 204, headers: { "X-Clover-Trash": "12,13" } }),
    new Response(null, { status: 204 }),
  ];
  globalThis.fetch = async () => replies.shift();
  const { api, TRASH_EVENT } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
  await api.del("/scrims/1");
  await api.del("/trash/5");
  assert.equal(fired.length, 1);
  assert.equal(fired[0].type, TRASH_EVENT);
  assert.deepEqual(fired[0].detail.ids, [12, 13]);
});

test("Trash is a real area: nav, theme, bootstrap accent, route and the Undo toast", async () => {
  const [nav, theme, html, app, main] = await Promise.all([
    read("../src/lib/nav.ts"), read("../src/lib/theme.ts"), read("../index.html"),
    read("../src/App.tsx"), read("../src/main.tsx"),
  ]);
  assert.match(nav, /id: "trash", label: "Trash"/);
  assert.match(theme, /trash: \{ accent: "violet", spotlight: "vexana"/);
  assert.match(html, /trash: "violet"/);
  assert.match(app, /case "trash":\s*\n\s*page = <TrashPage/);
  assert.match(app, /RESTORED_EVENT/);
  assert.match(main, /<TrashUndo \/>/);
});

test("the Trash page restores, purges only when allowed, and keeps private items marked", async () => {
  const page = await read("../src/pages/Trash.tsx");
  assert.match(page, /\/trash\/\$\{item\.id\}\/restore/);
  assert.match(page, /item\.can_purge && \(/);
  assert.match(page, /only you/);
  assert.match(page, /confirm/);
});
