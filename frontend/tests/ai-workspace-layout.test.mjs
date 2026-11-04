import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Render the actual workspace without running its API effects. Browser smoke tests
// also exercise resizing, keyboard interaction and the resulting layout dimensions.
const source = await readFile(new URL("../src/pages/CloverAI.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const nodeRequire = createRequire(import.meta.url);
const emptyComponent = () => null;
const localModules = {
  "../lib/api": { api: {}, qs: () => "" },
  "../lib/cloverAI": { AI_EXPORT_LIMIT: 2000 },
  "../lib/esports": { teamCode: () => "" },
  "../lib/util": { navigate: () => {} },
  "../components/Logo": { BrandImg: emptyComponent },
  "../components/ui": { ErrorNote: emptyComponent, Field: emptyComponent, Modal: emptyComponent },
  "../components/AIDataControls": { AIDataControls: emptyComponent },
  "../components/AIMatchPicker": { AIMatchPicker: emptyComponent },
  "../components/AIBoardPicker": { AIBoardPicker: emptyComponent },
  "../components/AIWebControls": { AIWebControls: emptyComponent },
  "../components/AIKnowledge": { AIKnowledge: emptyComponent },
  "../components/AIContributions": { AIContributions: emptyComponent, AIReviewQueue: emptyComponent },
  "../components/AIProposalCard": { AIActionHistory: emptyComponent, AIProposalCard: emptyComponent },
  "../components/AIVisuals": { AIMarkdown: emptyComponent, AIVisuals: emptyComponent },
  "react-markdown": { __esModule: true, default: emptyComponent },
  "remark-gfm": { __esModule: true, default: () => {} },
};
const module = { exports: {} };
vm.runInNewContext(outputText, {
  module, exports: module.exports,
  require: (name) => localModules[name] ?? nodeRequire(name),
});
const { CloverAIPage } = module.exports;

function render(layout) {
  return renderToStaticMarkup(React.createElement(CloverAIPage, {
    me: { id: 1, name: "Fixture", ign: "Fixture", role: "admin" },
    desktopLayout: layout,
    onToggleDesktopLayout: () => {},
  }));
}
function buttonFor(html, target) {
  const button = html.match(new RegExp(`<button\\b[^>]*aria-controls="${target}"[^>]*>`))?.[0];
  assert.ok(button, `button controlling ${target} exists`);
  return button;
}

test("desktop layout controls are reversible and expose their current state", () => {
  const open = render({ navigationOpen: true, historyOpen: true, headerOpen: true });
  const closed = render({ navigationOpen: false, historyOpen: false, headerOpen: false });
  for (const [target, hide, show] of [
    ["site-desktop-navigation", "Hide nav \\(site navigation\\)", "Show nav \\(site navigation\\)"],
    ["ai-desktop-history", "Hide chats \\(conversation history\\)", "Show chats \\(conversation history\\)"],
    ["ai-workspace-intro", "Hide header \\(AI workspace\\)", "Show header \\(AI workspace\\)"],
  ]) {
    assert.match(buttonFor(open, target), new RegExp(`aria-expanded="true".*aria-label="${hide}"`));
    assert.match(buttonFor(closed, target), new RegExp(`aria-expanded="false".*aria-label="${show}"`));
  }
  assert.match(open, /id="ai-desktop-history"[^>]*class="hidden lg:block /);
  assert.match(closed, /id="ai-desktop-history"[^>]*class="hidden relative rounded-xl /);
  assert.match(closed, /id="ai-workspace-intro" class="md:hidden flex /);
  assert.match(closed, /md:h-\[calc\(100dvh-125px\)\]/);
  assert.match(closed, /lg:grid-cols-\[minmax\(0,1fr\)\]/);
  assert.match(closed, /aria-label="AI workspace sections"/);
  assert.match(closed, /aria-label="Your context"/);
});

test("chat scroll waits for loaded messages and attachments are single-message", async () => {
  const chat = await readFile(new URL("../src/pages/CloverAI.tsx", import.meta.url), "utf8");
  const picker = await readFile(new URL("../src/components/AIBoardPicker.tsx", import.meta.url), "utf8");
  assert.match(chat, /!loadingChat && shouldScroll\.current && scrollRef\.current/);
  assert.match(chat, /const matches = attachedMatches, drafts = attachedDrafts, maps = attachedMaps/);
  assert.match(chat, /setAttachedMatches\(\[\]\); setAttachedDrafts\(\[\]\); setAttachedMaps\(\[\]\);/);
  assert.match(chat, /draft_ids: drafts\.map/);
  assert.match(picker, /share the selected saved team boards and notes with the external AI provider for my next message/);
});

test("the conversation can grow with readable type and attachments", () => {
  const html = render({ navigationOpen: true, historyOpen: true, headerOpen: true });
  assert.match(html, /min-h-min sm:h-\[min\(740px,calc\(100vh-235px\)\)\]/);
  assert.match(html, /min-h-\[200px\] max-h-\[50vh\] sm:max-h-none/);
  assert.match(html, /border-edge\/70 shrink-0/);
  assert.match(html, /id="ai-desktop-history"[^>]*relative[^>]*h-full min-h-0[^>]*><div class="absolute inset-0"/);
});

test("mobile history remains separate and global navigation only collapses on AI", async () => {
  const html = render({ navigationOpen: false, historyOpen: false, headerOpen: false });
  assert.match(buttonFor(html, "ai-mobile-history"), /aria-expanded="false".*aria-label="Open conversation history"/);
  assert.match(html, /id="ai-mobile-history"[^>]*class="hidden lg:hidden /);
  assert.match(html, /min-w-\[160px\] flex-1 md:min-w-0/);
  assert.match(html, /flex items-center gap-2 sm:gap-3 ml-auto/);
  assert.match(html, /aria-label="Desktop layout controls" class="hidden md:flex /);
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
  assert.match(app, /hideDesktopNav=\{section === "ai" && !aiLayout\.navigationOpen\}/);
  assert.match(layout, /id="site-desktop-navigation"/);
  assert.match(layout, /hideDesktopNav \? "" : "md:pl-60"/);
  assert.match(layout, /motion-reduce:transition-none/);
});
