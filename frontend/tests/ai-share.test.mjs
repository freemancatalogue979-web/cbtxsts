import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/cloverAI.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const lib = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const page = await readFile(new URL("../src/pages/SharedChat.tsx", import.meta.url), "utf8");
const dialog = await readFile(new URL("../src/components/AIShareDialog.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("../src/pages/CloverAI.tsx", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");

const memory = (value) => ({ getItem: () => value, setItem() {} });

test("share links are built on the current host and tokens are checked", () => {
  assert.equal(lib.shareUrl("/#/share/abc", "https://hub.example/"), "https://hub.example/#/share/abc");
  assert.ok(lib.isShareToken("Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab"));
  assert.ok(!lib.isShareToken("short"));
  assert.ok(!lib.isShareToken("../../etc/passwd/../../../../"));
  assert.ok(!lib.isShareToken(undefined));
});

test("reader settings default to the system font and clamp bad saved values", () => {
  assert.deepEqual(lib.readReaderPrefs(null), lib.READER_DEFAULTS);
  assert.equal(lib.READER_DEFAULTS.font, "system");
  assert.deepEqual(lib.readReaderPrefs(memory("{broken")), lib.READER_DEFAULTS);
  const odd = lib.readReaderPrefs(memory(JSON.stringify({ font: "comic", size: 99, zoom: 0.1, spacing: "airy", width: "wide" })));
  assert.deepEqual(odd, { font: "system", size: lib.READER_SIZE.max, zoom: lib.READER_ZOOM.min, spacing: "airy", width: "wide" });
  assert.equal(lib.readReaderPrefs(memory(JSON.stringify({ font: "serif", size: 20, zoom: 1.25 }))).zoom, 1.3);
});

test("reader uses the device's own font, text size, zoom, spacing and width controls", () => {
  assert.match(page, /system: \{ label: "System", stack: 'system-ui/);
  for (const label of ['"Smaller text"', '"Bigger text"', '"Zoom in"', '"Zoom out"', '"Line spacing"', '"Page width"']) assert.ok(page.includes(label), label);
  assert.match(css, /\.share-reader \{[^}]*font-family: var\(--reader-font\)/s);
  assert.match(css, /\.share-main \{[^}]*zoom: var\(--reader-zoom\)[^}]*font-size: var\(--reader-size\)/s);
  assert.match(page, /<AIMarkdown content=\{message\.content\} \/>/);
  assert.match(page, /<bdi className="ign flip-ign" dir="auto">/);
});

test("team links don't sign the member out and sign-in returns to the link", () => {
  assert.match(page, /await fetch\(`\/api\/shared\//);
  assert.doesNotMatch(page, /api\.get/);
  assert.match(page, /clover_after_login/);
  assert.match(app, /if \(route\[0\] === "share"\)/);
  assert.match(app, /window\.location\.hash = takeAfterLogin\(\)/);
  assert.ok(app.indexOf('route[0] === "share"') < app.indexOf("if (booting)"), "share opens before the sign-in gate");
});

test("share buttons live on answers and on the chat, with copy and revoke", () => {
  assert.match(chat, /aria-label="Share this answer"/);
  assert.match(chat, /aria-label="Share conversation"/g);
  assert.match(chat, /<AIShareDialog conversationId=\{selected\}/);
  assert.match(dialog, /navigator\.clipboard\.writeText/);
  assert.match(dialog, /api\.del\(`\/ai\/shares\//);
  assert.match(dialog, /Anyone with the link/);
  assert.match(dialog, /Team only/);
});
