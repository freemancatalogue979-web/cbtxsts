import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = await readFile(new URL("../src/components/AIVisuals.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const require = createRequire(import.meta.url);
const module = { exports: {} };
const local = {
  "./HeroImg": { HeroImg: ({name, variant}) => React.createElement("img", {src: `/heroes/${variant === "art" ? "" : "head-"}${name.toLowerCase()}.webp`, alt: name}) },
  "react-markdown": { __esModule: true, default: ({children}) => React.createElement("span", null, children) },
  "remark-gfm": { __esModule: true, default: () => {} },
};
vm.runInNewContext(outputText, { module, exports: module.exports, require: (name) => local[name] ?? require(name) });
const { safeLocalHeroImage, parseAIDiagram, AIMarkdown, AIVisuals } = module.exports;

test("only bundled hero images may be embedded by generated Markdown", () => {
  for (const src of ["https://tracker.example/pixel.webp", "//example.org/pixel.webp", "data:image/svg+xml,x", "/heroes/../secret.webp", "/heroes/evil.svg", "/heroes/x.borg.webp?token=1", "javascript:alert(1)"]) {
    assert.equal(safeLocalHeroImage(src), false, src);
  }
  assert.equal(safeLocalHeroImage("/heroes/x.borg.webp"), true);
  assert.equal(safeLocalHeroImage("/heroes/head-chang-e.webp"), true);
});

test("diagrams have bounded ordered nodes and treat untrusted text as text", () => {
  const raw = JSON.stringify({ title: "Rotation", steps: [{ label: "Clear", hero: "X.Borg" }, { label: "Rotate", detail: "to Turtle" }] });
  const diagram = parseAIDiagram(raw);
  assert.equal(diagram.title, "Rotation");
  assert.equal(diagram.steps.length, 2);
  assert.equal(diagram.steps[0].hero, "X.Borg");
  for (const value of ["bad", "[]", '{}', JSON.stringify({steps:[{label:'one'}]}), JSON.stringify({steps:Array(7).fill({label:'x'})}), "x".repeat(5001)]) {
    assert.equal(parseAIDiagram(value), null);
  }
  const html = renderToStaticMarkup(React.createElement(AIMarkdown, { content: `Plan\n\n\`\`\`clover-diagram\n${raw}\n\`\`\`` }));
  assert.match(html, /Rotation diagram/);
  assert.match(html, /Clear/);
  assert.match(html, /to Turtle/);
  assert.match(html, /\/heroes\/head-x\.borg\.webp/);
  const unsafe = JSON.stringify({title:"<script>bad</script>",steps:[{label:"<img src=x onerror=alert(1)>"},{label:"safe",hero:"../../tracker"}]});
  const escaped = renderToStaticMarkup(React.createElement(AIMarkdown, { content: `\`\`\`clover-diagram\n${unsafe}\n\`\`\`` }));
  assert.doesNotMatch(escaped, /<script>|<img src="\.\./);
  assert.match(escaped, /&lt;script&gt;/);
});

test("hero images and deterministic pick charts render source values and limitations", () => {
  const sources = [
    {kind:"hero",label:"X.Borg",visual:{kind:"hero",name:"X.Borg",title:"Firaga",roles:["Fighter"],ratings:{offense:7,durability:6}}},
    {kind:"esports_feed",label:"Rone",visual:{kind:"picks_chart",title:"Most-picked heroes · game 2",bars:[{label:"Alice",value:8},{label:"Fanny",value:5}],complete_games:10,omitted_heroes:0,incomplete_data:true,notice:"Counts use complete games only."}},
  ];
  const html = renderToStaticMarkup(React.createElement(AIVisuals, {sources}));
  assert.match(html, /\/heroes\/x\.borg\.webp/);
  assert.match(html, /7\/10/);
  assert.match(html, /8 picks/);
  assert.match(html, /10 complete games counted/);
  assert.match(html, /some data is incomplete/);
  assert.match(html, /Historical community hero profile/);
});
