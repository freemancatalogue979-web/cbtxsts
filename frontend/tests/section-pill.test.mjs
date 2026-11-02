import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = await readFile(new URL("../src/components/ui.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const module = { exports: {} };
vm.runInNewContext(outputText, { module, exports: module.exports, require: createRequire(import.meta.url) });
const { Field, SectionTitle } = module.exports;

test("shared section titles use an accessible heading pill and retain their actions", () => {
  const html = renderToStaticMarkup(React.createElement(SectionTitle, {
    right: React.createElement("button", { type: "button" }, "Open"),
    children: "Current team weakness",
  }));
  assert.match(html, /<h2 class="section-pill min-w-0">Current team weakness<\/h2>/);
  assert.match(html, /<button type="button">Open<\/button>/);
});

test("form labels stay as labels rather than becoming decorative heading pills", () => {
  const html = renderToStaticMarkup(React.createElement(Field, { label: "Your name" }, React.createElement("input")));
  assert.match(html, /<label class="block"><span class="label block mb-1\.5">Your name<\/span><input\/>/);
  assert.doesNotMatch(html, /section-pill/);
});

test("the private chat eyebrow uses a pill and the read-only draft board keeps its own skin", async () => {
  const chat = await readFile(new URL("../src/pages/CloverAI.tsx", import.meta.url), "utf8");
  const draftBoard = await readFile(new URL("../src/components/DraftBoard.tsx", import.meta.url), "utf8");
  assert.match(chat, /className="section-pill">PRIVATE CONVERSATION/);
  assert.doesNotMatch(draftBoard, /section-pill/);
});

test("section pills have angled corners and respect reduced motion", async () => {
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  const pill = css.match(/\.section-pill\s*\{([^}]+)\}/)?.[1] ?? "";
  const accent = css.match(/\.section-pill::before\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(pill, /border-radius:\s*0\s*;/);
  assert.match(pill, /clip-path:\s*polygon\(/);
  assert.match(pill, /animation:\s*section-pill-enter/);
  assert.match(accent, /animation:\s*section-pill-accent/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.section-pill,\s*\.section-pill::before\s*\{\s*animation:\s*none;/);
});
