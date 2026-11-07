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
  assert.match(html, /<header class="page-hero mb-5" data-slides="1">/);
  assert.match(html, /class="page-hero__art" aria-hidden="true"><img src="\/heroes\/ling\.webp" alt="" width="240" height="390"/);
  assert.match(html, /class="page-hero__icon" aria-hidden="true">/);
  assert.match(html, /class="page-hero__eyebrow">Team ops · Scrims</);
  // One real heading for assistive tech; the animated letters are decorative.
  assert.match(html, /<h1 class="sr-only">Scrim Manager<\/h1>/);
  assert.match(html, /<div class="page-hero__title"><span aria-hidden="true"><span class="flip-word"><span class="flip-char" style="--i:0">S<\/span>/);
  assert.match(html, /class="page-hero__actions"><button>New<\/button>/);
  // A single slide is not a carousel: no controls, timer or carousel roles.
  assert.doesNotMatch(html, /hero-controls|page-hero__timer|aria-roledescription/);
  // Art is never drawn wider than half its 240px source, so it stays sharp on 2x screens.
  assert.match(css, /\.page-hero__art \{[^}]*width: 120px;/);
  assert.doesNotMatch(css.match(/\.page-hero__art img \{[^}]*\}/)?.[0] ?? "", /blur\(/);
});

test("page headers still work without any chrome (e.g. outside the shell)", () => {
  const html = renderToStaticMarkup(React.createElement(ui.PageTitle, { title: "Team Admin" }));
  assert.match(html, /<h1 class="sr-only">Team Admin<\/h1>/);
  assert.doesNotMatch(html, /page-hero__art|page-hero__icon|page-hero__eyebrow/);
});

test("extra slides turn the header into an accessible 3D carousel", () => {
  const html = renderToStaticMarkup(React.createElement(ui.PageTitle, {
    title: "Good morning, Dre", sub: "Saturday",
    slides: [{ eyebrow: "Season 42 · season goal", title: "Tier 2 Qualification programme" }, { eyebrow: "The 9 CLOVER loop", title: "Play. Review. Train. Improve.", steps: ["Play", "Review", "Train", "Improve"] }],
  }));
  assert.match(html, /data-slides="3"/);
  assert.match(html, /class="page-hero__deck" role="region" aria-roledescription="carousel" aria-label="Good morning, Dre highlights"/);
  assert.match(html, /class="hero-slide" data-state="active" role="group" aria-roledescription="slide" aria-label="1 of 3">/);
  // Hidden faces can't be read or tabbed into.
  assert.equal((html.match(/data-state="waiting"[^>]*aria-hidden="true" inert=""/g) ?? []).length, 2);
  // Non-main slide titles are read once, as plain text.
  assert.match(html, /<span class="sr-only">Tier 2 Qualification programme<\/span><span aria-hidden="true">/);
  assert.match(html, /<ol class="hero-loop" aria-label="Team loop"><li class="hero-loop__step" style="--i:0;--n:4">Play<\/li>/);
  // Members can pause it (WCAG 2.2.2) and jump to any slide.
  assert.match(html, /<button type="button" class="hero-controls__pause" aria-label="Pause slideshow">/);
  assert.match(html, /aria-label="Show slide 2 of 3: Tier 2 Qualification programme"/);
  assert.match(html, /aria-label="Show slide 1 of 3: Good morning, Dre" aria-current="true"/);
  assert.match(html, /<div class="page-hero__timer" aria-hidden="true"><span data-running="true" style="animation-duration:6500ms">/);
  assert.equal(ui.HERO_SLIDE_MS, 6500);
});

test("slides roll like a cube and letters flip in, but stay still for calm motion", () => {
  assert.match(css, /\.page-hero__deck \{ display: grid; perspective: 900px; \}/);
  assert.match(css, /\.hero-slide\[data-state="leaving"\] \{ opacity: 0; transform: rotateX\(86deg\);/);
  assert.match(css, /\.hero-slide\[data-state="waiting"\] \{ opacity: 0; transform: rotateX\(-86deg\);/);
  assert.match(css, /\.hero-slide\[data-state="active"\] \.flip-char \{\s*animation: flip-in/);
  assert.match(css, /@keyframes flip-in \{\s*0% \{ opacity: 0; transform: translateY\(0\.5em\) rotateX\(-100deg\); \}/);
  // Extruded edge in the area's colour.
  assert.match(css, /\.page-hero__title \{[^}]*text-shadow:\s*0 1px 0 color-mix\(in srgb, var\(--color-crim\) 70%, #000\)/);
  // The entrance never pins the transform, so pointer tilt keeps working afterwards.
  assert.match(css, /animation: hero-rise 700ms cubic-bezier\(\.2, \.8, \.2, 1\) backwards;/);
  for (const block of [css.split('html[data-effects="calm"] .page-hero,')[1] ?? "", css.split("@media (prefers-reduced-motion: reduce) {\n  .page-hero,")[1] ?? ""]) {
    assert.match(block, /animation: none !important;/);
    assert.match(block, /\.hero-slide \{ transform: none !important;/);
  }
  const uiSource = ui.PageTitle.toString();
  assert.match(uiSource, /prefers-reduced-motion|useCalmMotion/);
});

test("stylised names keep their exact letters inside the all-caps style", () => {
  for (const char of "αмɪʀ") assert.equal(ui.keepsCase(char), true, char);
  for (const char of "aZé9⚝ᴋ") assert.equal(ui.keepsCase(char), false, char);
  assert.deepEqual(Array.from(ui.splitGraphemes("ᴋαмɪɴαʀɪ⚝")), ["ᴋ", "α", "м", "ɪ", "ɴ", "α", "ʀ", "ɪ", "⚝"]);
  assert.deepEqual(Array.from(ui.splitGraphemes("e\u0301👍🏽")), ["e\u0301", "👍🏽"]);
  const html = renderToStaticMarkup(React.createElement(ui.PageTitle, { title: "Hi ᴋα" }));
  assert.match(html, /<span class="flip-char" style="--i:2">ᴋ<\/span><span class="flip-char flip-char--keep" style="--i:3">α<\/span>/);
  assert.match(css, /\.flip-char--keep \{ text-transform: none; \}/);
  // The same protection applies to names in the sidebar, drawer and top bar.
  assert.equal(renderToStaticMarkup(React.createElement(ui.CaseSafe, { text: "Dre" })), "Dre");
  assert.equal(renderToStaticMarkup(React.createElement(ui.CaseSafe, { text: "ᴋα⚝" })), 'ᴋ<span class="normal-case">α</span>⚝');
  assert.equal((layout.match(/<CaseSafe text=\{user\.ign \|\| /g) ?? []).length, 3);
});

test("symbols in names (like ⚝) have a bundled fallback that loads only when needed", async () => {
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.match(main, /import "@fontsource\/noto-sans-symbols\/500\.css";/);
  const faces = await readFile(new URL("../node_modules/@fontsource/noto-sans-symbols/500.css", import.meta.url), "utf8");
  const symbols = faces.split("noto-sans-symbols-symbols-500-normal */")[1]?.split("}")[0] ?? "";
  assert.match(symbols, /font-family: 'Noto Sans Symbols'/);
  // Every face is range-limited, so it is fetched only for characters Courier lacks.
  assert.equal((faces.match(/@font-face/g) ?? []).length, (faces.match(/unicode-range:/g) ?? []).length);
  const ranges = symbols.match(/unicode-range: ([^;]+);/)[1].split(",").map((r) => r.trim().replace("U+", "").split("-").map((h) => parseInt(h, 16)));
  assert.ok(ranges.some(([lo, hi = lo]) => lo <= 0x269d && 0x269d <= hi), "⚝ is covered");
  assert.match(css, /--font-sans: "Courier Std", Courier,[^;]*"Noto Sans Symbols"/);
});

test("the dashboard header rolls through season goal, team loop and next up", async () => {
  const dashboard = await readFile(new URL("../src/pages/Dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /slides=\{slides\}/);
  assert.match(dashboard, /eyebrow: goal\.length \? `\$\{label\} · season goal` : "Season goal"/);
  assert.match(dashboard, /steps: \["Play", "Review", "Train", "Improve"\]/);
  assert.match(dashboard, /eyebrow: `Next up · \$\{dayLabel\(activity\.date\)\}/);
});

test("the new four-leaf 9 emblem is the brand everywhere", async () => {
  const png = async (name) => {
    const data = await readFile(new URL(`../public/brand/${name}`, import.meta.url));
    assert.equal(data.toString("latin1", 1, 4), "PNG", name);
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), colorType: data[25] };
  };
  const source = await png("logo-source.png");
  assert.deepEqual([source.width, source.height, source.colorType], [1254, 1254, 6], "transparent RGBA source");
  for (const [name, size] of [["logo.png", 256], ["logo-full.png", 512], ["favicon-16.png", 16], ["favicon-32.png", 32], ["favicon-48.png", 48], ["apple-touch-icon.png", 180]]) {
    const info = await png(name);
    assert.deepEqual([info.width, info.height], [size, size], name);
  }
  assert.equal((await png("logo.png")).colorType, 6, "UI mark keeps transparency");
  assert.equal((await png("apple-touch-icon.png")).colorType, 2, "iOS icon is opaque");
  const script = await readFile(new URL("../scripts/make-brand.py", import.meta.url), "utf8");
  assert.match(script, /SRC = ROOT \/ "public" \/ "brand" \/ "logo-source\.png"/);
  const logo = await readFile(new URL("../src/components/Logo.tsx", import.meta.url), "utf8");
  assert.match(logo, /className="brand-emblem mx-auto"/);
  assert.match(css, /\.brand-emblem \{[^}]*drop-shadow/);
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
