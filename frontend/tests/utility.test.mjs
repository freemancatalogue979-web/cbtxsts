import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
async function load(path) {
  const { outputText } = ts.transpileModule(await read(path), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, require, performance, window: undefined });
  return module.exports;
}

const [page, solo, evidence, strategy, insights, dashboard, nav, theme, html, ai] = await Promise.all([
  read("../src/pages/Utility.tsx"), read("../src/components/SoloGames.tsx"), read("../src/components/MatchEvidence.tsx"),
  read("../src/components/StrategyMaker.tsx"), read("../src/components/DashboardInsights.tsx"), read("../src/pages/Dashboard.tsx"),
  read("../src/lib/nav.ts"), read("../src/lib/theme.ts"), read("../index.html"), read("../src/pages/CloverAI.tsx"),
]);
const charts = await load("../src/components/Charts.tsx");

test("Utility is its own nav tab with its own colours, and it left the AI page", () => {
  assert.match(nav, /\{ id: "utility", label: "Utility", short: "Utility", icon: ChartNoAxesCombined, group: "command"/);
  assert.match(theme, /utility: \{ accent: "cyan", spotlight: "lunox"/);
  assert.match(html, /utility: "cyan"/);
  assert.doesNotMatch(ai, /AIUtility|AILearning|"utility"|"learning"/);
});

test("players are never told files are read by an AI", () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const [name, src] of Object.entries({ page, solo, evidence, strategy, insights })) {
    // Endpoint paths like "/ai-tools/strategy" are fine; words on screen are not.
    assert.doesNotMatch(strip(src), /\bAI\b|used_ai|[Aa]rtificial/, name);
  }
  assert.match(solo, /read_directly \? " · read straight from the sheet"/);
});

test("players see heroes with no data and can add a game on that hero", () => {
  assert.match(solo, /key: "no_data", title: "Heroes with no data"/);
  assert.match(solo, /key: "not_playing", title: "Heroes you've stopped playing"/);
  assert.match(solo, /key: "lane_meta", title: "Strong in your lane right now"/);
  assert.match(solo, /aria-label=\{`Add a \$\{h\.hero\} game`\}/);
  assert.match(page, /<HeroGaps gaps=\{data\?\.gaps\} lane=\{lane\} onAdd=\{addFor\} \/>/);
  assert.match(page, /<SoloGameEditor game=\{editing\.game\} hero=\{editing\.hero\}/);
});

test("staff tabs follow the server's permissions", () => {
  assert.match(page, /const FILLERS = new Set\(\["admin", "captain"\]\)/);
  assert.match(page, /const WRITERS = new Set\(\["admin", "captain", "coach"\]\)/);
  assert.match(page, /\{view === "matches" && canFill && <MatchEvidence \/>\}/);
  assert.match(page, /\{view === "strategy" && canWrite && <StrategyMaker meta=\{meta\} \/>\}/);
});

test("match evidence: browse, choose the game, read, review the chart — added only on confirm", () => {
  assert.match(evidence, /api\.get<UtilityMatch\[\]>\(`\/utility\/matches\?\$\{params\}`\)/);
  assert.match(evidence, /api\.post<UtilityRead>\("\/utility\/read", \{ kind: picked\.kind, id: picked\.id, game_no: gameNo, image_url: url \}\)/);
  assert.match(evidence, /<MatchSheetChart ours=\{ours\} enemy=\{enemy\}/);
  assert.match(evidence, /<ScoreboardFields form=\{ours\} onChange=\{setOurs\}/);
  assert.match(evidence, /<EnemyScoreboard form=\{enemy\} onChange=\{setEnemy\}/);
  const apply = evidence.indexOf('"/utility/apply"');
  assert.ok(apply > evidence.indexOf("async function confirm()"), "apply only runs from confirm()");
  assert.equal(evidence.match(/\/utility\/apply/g).length, 1);
  assert.match(evidence, /Confirm & add to game \{game_no\}/);
});

test("strategy is generated (optionally from a document) and saved to the playbook", () => {
  assert.match(strategy, /api\.post<Draft>\("\/ai-tools\/strategy", \{ topic: topic\.trim\(\), category, opponent: opponent\.trim\(\), document_url: doc\?\.url \?\? "" \}\)/);
  assert.match(strategy, /api\.post<\{ id: number \}>\("\/strategy"/);
  assert.match(strategy, /const DOC_ACCEPT = "\.pdf,\.docx,\.txt,\.md,\.csv,\.tsv,\.xlsx"/);
});

test("the dashboard carries the big insight charts", () => {
  assert.match(dashboard, /<DashboardInsights \/>/);
  assert.match(insights, /api\.get<Insights>\(`\/dashboard\/insights\?weeks=\$\{weeks\}`\)/);
  for (const chart of ["<BarChart", "<LineChart", "<Heatmap", "<Donut", "<HBars", "<Sparkline"]) assert.ok(insights.includes(chart), chart);
  assert.match(insights, /Who's active/);
});

test("line charts draw animated paths and ship a screen-reader table", () => {
  const html = renderToStaticMarkup(React.createElement(charts.LineChart, {
    caption: "Form", labels: ["a", "b", "c"], series: [{ name: "KDA", color: "red", values: [1, null, 3], area: true }, { name: "Win", color: "green", values: [40, 60, 80], right: true, dashed: true }],
  }));
  assert.match(html, /role="img" aria-label="Form"/);
  assert.match(html, /class="chart-draw chart-glow"/);
  assert.match(html, /stroke-dasharray="5 6"/);
  assert.match(html, /<table class="sr-only"><caption>Form<\/caption>/);
  assert.match(html, /<td>—<\/td>/); // the gap stays a gap
});

test("bars, donut, ring and heatmap render with their animations", () => {
  const bars = renderToStaticMarkup(React.createElement(charts.BarChart, { caption: "Weeks", labels: ["w1", "w2"], series: [{ name: "Wins", color: "g", values: [2, 0] }] }));
  assert.equal(bars.match(/class="chart-grow"/g).length, 2);
  const donut = renderToStaticMarkup(React.createElement(charts.Donut, { caption: "Split", parts: [{ label: "A", value: 3, color: "r" }, { label: "B", value: 1, color: "b" }] }));
  assert.match(donut, /aria-label="Split: A 3, B 1"/);
  assert.match(donut, /mask=/);
  const ring = renderToStaticMarkup(React.createElement(charts.Ring, { value: 62.4, label: "Win rate" }));
  assert.match(ring, /aria-label="Win rate: 62%"/);
  const heat = renderToStaticMarkup(React.createElement(charts.Heatmap, { caption: "Active", columns: ["1", "2", "3"], rows: [{ label: "Tobi", cells: [1, 0, 2] }] }));
  assert.equal(heat.match(/class="chart-pop"/g).length, 3);
  assert.match(heat, /Tobi · 2: not active/);
});

test("calm effects and reduced motion switch every chart animation off", async () => {
  const css = await read("../src/index.css");
  assert.match(css, /html\[data-effects="calm"\] \.chart-draw/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.chart-draw, \.chart-fade, \.chart-grow, \.chart-pop, \.chart-bar-x, \.chart-ring/);
});

test("weekly buckets and rolling form come straight from the games", async () => {
  const soloSrc = solo;
  const start = soloSrc.indexOf("const isoDay");
  const end = soloSrc.indexOf("const LANE_COLOR");
  const chunk = `const fmtDate = (s) => s;\n${soloSrc.slice(start, end)}\nmodule.exports = { weeklyBuckets, rollingForm };`;
  const { outputText } = ts.transpileModule(chunk, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} };
  vm.runInNewContext(outputText.replace(/^export /gm, ""), { module, exports: module.exports });
  const plain = (v) => JSON.parse(JSON.stringify(v)); // arrays from the vm realm
  const { weeklyBuckets: wb, rollingForm: rf } = module.exports;
  const weeklyBuckets = (...a) => plain(wb(...a));
  const rollingForm = (...a) => plain(rf(...a));
  const games = [
    { id: 1, played_on: "2026-10-05", result: "WIN", kills: 5, deaths: 1, assists: 5, rating: 10 },
    { id: 2, played_on: "2026-10-06", result: "LOSS", kills: 1, deaths: 4, assists: 3, rating: 6 },
    { id: 3, played_on: "2026-09-29", result: "WIN", kills: null, deaths: null, assists: null, rating: null },
  ];
  const weeks = weeklyBuckets(games, 3, new Date(2026, 9, 7));
  assert.deepEqual(weeks.map((w) => w.week), ["2026-09-21", "2026-09-28", "2026-10-05"]);
  assert.deepEqual(weeks.map((w) => w.games), [0, 1, 2]);
  assert.equal(weeks[2].win_rate, 50);
  assert.equal(weeks[2].kda, 5.5);
  const roll = rollingForm(games, 10, 2);
  assert.deepEqual(roll.map((r) => r.game.id), [3, 1, 2]);
  assert.equal(roll[2].win_rate, 50);
  assert.equal(roll[2].rating, 8);
});
