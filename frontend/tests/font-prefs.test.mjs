import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Load the real preference module (types are erased) so storage parsing is tested
// rather than re-implemented here.
const source = await readFile(new URL("../src/lib/fontPrefs.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const module = { exports: {} };
vm.runInNewContext(outputText, { module, exports: module.exports, require: createRequire(import.meta.url) });
const { DEFAULT_FONT, FONT_CHOICES, FONT_STORAGE_KEY, applyFontChoice, parseFontChoice, readFontChoice, saveFontChoice } = module.exports;

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test("DM Mono is the default text style; Montserrat and Corptic stay options", () => {
  assert.equal(DEFAULT_FONT, "dmmono");
  // The module runs in a separate VM realm, so compare host-realm copies.
  assert.deepEqual(Array.from(FONT_CHOICES, (choice) => choice.id), ["dmmono", "montserrat", "corptic"]);
  const dm = FONT_CHOICES.find((choice) => choice.id === "dmmono");
  assert.match(dm.stack, /^"DM Mono",.*monospace$/);
  const montserrat = FONT_CHOICES.find((choice) => choice.id === "montserrat");
  assert.match(montserrat.stack, /^"Montserrat Variable"/);
  assert.doesNotMatch(montserrat.stack, /Corptic/);
  const corptic = FONT_CHOICES.find((choice) => choice.id === "corptic");
  assert.match(corptic.stack, /^"Corptic",\s*"Montserrat Variable"/);
});

test("unknown, missing and corrupt saved values fall back to DM Mono", () => {
  assert.equal(parseFontChoice(undefined), "dmmono");
  assert.equal(parseFontChoice(null), "dmmono");
  assert.equal(parseFontChoice(""), "dmmono");
  assert.equal(parseFontChoice("COMIC"), "dmmono");
  assert.equal(parseFontChoice("corptic"), "corptic");
  assert.equal(parseFontChoice("montserrat"), "montserrat");
  assert.equal(parseFontChoice("dmmono"), "dmmono");
  const empty = fakeStorage();
  assert.equal(readFontChoice(empty), "dmmono");
  assert.equal(readFontChoice(fakeStorage({ [FONT_STORAGE_KEY]: "corptic" })), "corptic");
  assert.equal(readFontChoice(fakeStorage({ [FONT_STORAGE_KEY]: "papyrus" })), "dmmono");
  // A browser that blocks storage must not break the app.
  assert.equal(readFontChoice(null), "dmmono");
  assert.equal(readFontChoice({ getItem() { throw new Error("blocked"); } }), "dmmono");
});

test("only non-default choices are written, so a future default reaches everyone else", () => {
  const storage = fakeStorage();
  saveFontChoice(storage, "dmmono");
  assert.equal(storage.data.has(FONT_STORAGE_KEY), false);
  saveFontChoice(storage, "corptic");
  assert.equal(storage.getItem(FONT_STORAGE_KEY), "corptic");
  saveFontChoice(storage, "montserrat");
  assert.equal(storage.getItem(FONT_STORAGE_KEY), "montserrat");
  saveFontChoice(storage, "dmmono");
  assert.equal(storage.getItem(FONT_STORAGE_KEY), null);
  // Saving must survive a throwing or missing store instead of crashing the app.
  assert.doesNotThrow(() => saveFontChoice(null, "corptic"));
  assert.doesNotThrow(() => saveFontChoice({ setItem() { throw new Error("quota"); }, removeItem() { throw new Error("quota"); } }, "corptic"));
});

test("applying a choice only ever sets the three supported font attributes", () => {
  const element = { dataset: {} };
  applyFontChoice("corptic", element);
  assert.equal(element.dataset.font, "corptic");
  applyFontChoice("montserrat", element);
  assert.equal(element.dataset.font, "montserrat");
  applyFontChoice("something-else", element);
  assert.equal(element.dataset.font, "dmmono");
});

test("the app loads the saved style before its first paint and keeps the state in sync", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const bootstrap = html.split("<head>")[1]?.split("</script>")[0] ?? "";
  // The inline script must run in the head, before the module entry point.
  assert.ok(bootstrap.indexOf("clover_font_choice") > 0, "bootstrap reads the saved font");
  assert.ok(html.indexOf("clover_font_choice") < html.indexOf("/src/main.tsx"), "applied before React loads");
  assert.match(bootstrap, /dataset\.font\s*=/);
  assert.match(bootstrap, /font === "montserrat" \|\| font === "corptic" \? font : "dmmono"/);
  assert.match(bootstrap, /catch \(error\) \{\s*root\.dataset\.font = "dmmono";/);

  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /useState<FontChoice>\(\(\) => readFontChoice\(deviceStorage\(\)\)\)/);
  assert.match(app, /applyFontChoice\(font\); saveFontChoice\(deviceStorage\(\), font\)/);
  assert.match(app, /<Layout[^>]*font=\{font\} onFontChange=\{setFont\}/s);
});

test("the profile menu exposes an accessible font picker for everyone", async () => {
  const layout = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /role="radiogroup" aria-label="Text style"/);
  assert.match(layout, /role="radio" aria-checked=\{active\}/);
  assert.match(layout, /Saved on this device only/);
  assert.match(layout, /<FontPicker value=\{font\} onChange=\{onFontChange\} \/>/);
  // The picker lives in the profile modal, which both the sidebar and the mobile
  // drawer open, so it is reachable on every screen size.
  assert.match(layout, /function UserCard\(\{ user, font, onFontChange/);
  assert.match(layout, /<ProfileModal user=\{user\} font=\{font\} onFontChange=\{onFontChange\}/);
  // The profile dialog is announced, and stays scrollable on short phones.
  assert.match(layout, /role="dialog" aria-modal="true" aria-label="Edit profile"/);
  assert.match(layout, /max-h-\[90dvh\] overflow-y-auto/);
  // The trigger is named by its own visible text (name + role), so it only needs
  // a tooltip; an aria-label here would fight the label-content-name rule.
  assert.match(layout, /onClick=\{\(\) => setEditing\(true\)\} title="Edit profile"/);
});
