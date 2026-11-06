import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, require });
  return module.exports;
}

const nav = await load("../src/lib/nav.ts");
const ui = await load("../src/components/ui.tsx");
const themeSource = await readFile(new URL("../src/lib/theme.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const layout = await readFile(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

test("every themed area is reachable from the grouped navigation exactly once", () => {
  const sections = [...themeSource.matchAll(/^\s{2}(\w+): \{ accent:/gm)].map((m) => m[1]).filter((id) => id !== "login");
  const ids = nav.NAV_ITEMS.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicates");
  assert.deepEqual([...ids].sort(), [...sections].sort());
  const groups = new Set(nav.NAV_GROUPS.map((group) => group.id));
  for (const item of nav.NAV_ITEMS) {
    assert.ok(groups.has(item.group), `${item.id} has a real group`);
    assert.ok(item.blurb.length > 10, `${item.id} has a blurb`);
    assert.ok(item.short.length <= 8, `${item.id} short label fits the bottom bar`);
  }
  for (const id of nav.MOBILE_QUICK) assert.ok(nav.navItem(id), `${id} exists`);
});

test("team admin only appears for admins", () => {
  assert.ok(!nav.visibleNav(false).some((item) => item.id === "admin"));
  assert.ok(nav.visibleNav(true).some((item) => item.id === "admin"));
});

test("quick-jump search ranks label matches first and understands keywords", () => {
  const items = nav.visibleNav(true);
  assert.equal(nav.searchNav(items, "draft")[0].id, "drafts");
  assert.equal(nav.searchNav(items, "mpl")[0].id, "esports");
  assert.equal(nav.searchNav(items, "  ROSTER ")[0].id, "players");
  assert.equal(nav.searchNav(items, "pick ban")[0].id, "drafts");
  assert.equal(nav.searchNav(items, "zzzz").length, 0);
  assert.equal(nav.searchNav(items, "").length, items.length);
});

test("the collapsed sidebar choice is saved per device and survives blocked storage", () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  assert.equal(nav.readNavCollapsed(storage), false);
  nav.saveNavCollapsed(storage, true);
  assert.equal(data.get("clover_nav_collapsed"), "1");
  assert.equal(nav.readNavCollapsed(storage), true);
  nav.saveNavCollapsed(storage, false);
  assert.equal(data.size, 0, "default is not stored");
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(nav.readNavCollapsed(broken), false);
  assert.doesNotThrow(() => nav.saveNavCollapsed(broken, true));
  assert.equal(nav.readNavCollapsed(null), false);
});

test("page headers show the area's icon, eyebrow and crisp hero art", () => {
  const html = renderToStaticMarkup(React.createElement(ui.PageChrome.Provider, {
    value: { icon: React.createElement("svg"), eyebrow: "Team ops · Scrims", art: "/heroes/ling.webp" },
  }, React.createElement(ui.PageTitle, { title: "Scrim Manager", sub: "Book, record, review.", right: React.createElement("button", null, "New") })));
  assert.match(html, /<header class="page-hero mb-5">/);
  assert.match(html, /class="page-hero__art" aria-hidden="true"><img src="\/heroes\/ling\.webp" alt="" width="240" height="390"/);
  assert.match(html, /class="page-hero__icon" aria-hidden="true">/);
  assert.match(html, /class="page-hero__eyebrow">Team ops · Scrims</);
  assert.match(html, /<h1 class="page-hero__title">Scrim Manager<\/h1>/);
  assert.match(html, /class="page-hero__actions"><button>New<\/button>/);
  // Art is never drawn wider than half its 240px source, so it stays sharp on 2x screens.
  assert.match(css, /\.page-hero__art \{[^}]*width: 120px;/);
  assert.doesNotMatch(css.match(/\.page-hero__art img \{[^}]*\}/)?.[0] ?? "", /blur\(/);
});

test("page headers still work without any chrome (e.g. outside the shell)", () => {
  const html = renderToStaticMarkup(React.createElement(ui.PageTitle, { title: "Team Admin" }));
  assert.match(html, /<h1 class="page-hero__title">Team Admin<\/h1>/);
  assert.doesNotMatch(html, /page-hero__art|page-hero__icon|page-hero__eyebrow/);
});

test("tabs are an accessible tablist with one focusable selected tab", () => {
  const html = renderToStaticMarkup(React.createElement(ui.Tabs, {
    label: "Review status", value: "open", onChange() {},
    tabs: [{ id: "all", label: "All" }, { id: "open", label: "Open", count: 3 }],
  }));
  assert.match(html, /class="tabs mb-4" role="tablist" aria-label="Review status"/);
  assert.match(html, /role="tab" aria-selected="false" tabindex="-1"[^>]*>.*All/);
  assert.match(html, /role="tab" aria-selected="true" tabindex="0"[^>]*>.*Open.*<span class="tabs__count">3<\/span>/);
  assert.match(css, /\.tabs__tab\[aria-selected="true"\] \{/);
  assert.match(css, /\.tabs__tab:focus-visible \{ outline: 2px solid var\(--color-crim\)/);
});

test("stat tiles carry their tone to the accent rail and optional icon", () => {
  const html = renderToStaticMarkup(React.createElement(ui.StatTile, { label: "Win rate", value: "68%", tone: "good", icon: React.createElement("svg") }));
  assert.match(html, /class="card stat-tile px-3\.5 py-3" data-tone="good"/);
  assert.match(html, /class="stat-tile__icon" aria-hidden="true"><svg><\/svg>/);
  assert.match(css, /\.stat-tile\[data-tone="bad"\] \{ --stat-tone: var\(--color-danger\); \}/);
});

test("a loss is always red, whatever colour the area uses", async () => {
  const util = await readFile(new URL("../src/lib/util.tsx", import.meta.url), "utf8");
  assert.match(util, /LOSS: "text-danger border-danger\/40 bg-danger-dim\/60"/);
  const dashboard = await readFile(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /r === "LOSS" \? "bg-danger/);
  assert.match(dashboard, /card border-danger\/60 bg-danger-dim\/40/);
});

test("the sidebar is grouped, collapsible and marks the current page", () => {
  assert.match(layout, /role="group" aria-label=\{group\.label\}/);
  assert.match(layout, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(layout, /aria-label=\{collapsed \? "Expand sidebar" : "Collapse sidebar"\} aria-expanded=\{!collapsed\}/);
  assert.match(layout, /title=\{collapsed \? `\$\{item\.label\}/, "collapsed icons keep a tooltip");
  assert.match(css, /\.nav-rail \.nav-item__label \{ position: absolute; width: 1px;/, "labels stay readable by screen readers when collapsed");
  assert.match(css, /\.nav-item\[aria-current="page"\] \{/);
  assert.match(layout, /<PageChrome\.Provider value=\{chrome\}>/);
});

test("Ctrl/⌘+K opens an accessible quick-jump palette", async () => {
  assert.match(layout, /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key\.toLowerCase\(\) === "k"/);
  const palette = await readFile(new URL("../src/components/CommandPalette.tsx", import.meta.url), "utf8");
  assert.match(palette, /role="dialog" aria-modal="true" aria-label="Jump to a page"/);
  assert.match(palette, /role="combobox"/);
  assert.match(palette, /aria-activedescendant=/);
  assert.match(palette, /role="listbox"/);
  assert.match(palette, /role="option"/);
  assert.match(palette, /restore\.current\.focus\(\)/, "focus returns to where it was");
});

test("the mobile drawer behaves like a dialog", () => {
  assert.match(layout, /className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu"/);
  assert.match(layout, /if \(event\.key === "Escape"\) setMobileNav\(false\)/);
  assert.match(layout, /drawerClose\.current\?\.focus\(\)/);
});

test("pages load on demand while login and the dashboard stay instant", () => {
  assert.match(app, /import \{ DashboardPage \} from "\.\/pages\/Dashboard";/);
  assert.match(app, /import \{ Login \} from "\.\/pages\/Login";/);
  for (const page of ["Training", "Scrims", "CloverAI", "Maps", "Archive", "Admin"]) {
    assert.match(app, new RegExp(`lazy\\(\\(\\) => import\\("\\./pages/${page}"\\)`), page);
    assert.doesNotMatch(app, new RegExp(`^import \\{[^}]*\\} from "\\./pages/${page}";`, "m"), `${page} not eagerly imported`);
  }
  assert.match(app, /<Suspense fallback=\{<Spinner label="Opening" \/>\}>\{page\}<\/Suspense>/);
});
