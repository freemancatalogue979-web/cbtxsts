import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [board, players, perf, css] = await Promise.all([
  read("../src/components/PlayersBoard.tsx"), read("../src/pages/Players.tsx"),
  read("../src/components/PlayerPerformance.tsx"), read("../src/index.css"),
]);

test("the Players tab opens with the leaderboard, then the roster", () => {
  assert.match(players, /<PlayersLeaderboard meId=\{me\.id\} \/>\s*<SectionTitle>Roster<\/SectionTitle>/);
  assert.match(board, /api\.get<Leaderboard>\(`\/players\/leaderboard\?period=\$\{period\}`\)/);
  // Best and least are called out; the viewer is marked.
  assert.match(board, /best=\{r\.user_id === board\.best\} least=\{r\.user_id === board\.least\} isMe=\{r\.user_id === meId\}/);
  assert.match(board, /Crown size=\{10\} aria-hidden="true" \/> Best/);
  assert.match(board, /TrendingDown size=\{10\} aria-hidden="true" \/> Needs work/);
});

test("players are pushed to add their data, straight to Utility", () => {
  assert.match(board, /"You're not on the board yet"/);
  assert.match(board, /Not on the board yet · \{waiting\.length\}/);
  assert.ok((board.match(/navigate\("utility", "add"\)/g) ?? []).length >= 3);
});

test("each player page shows their Utility games as charts and heroes for the whole team", () => {
  assert.match(players, /<UtilityPanel userId=\{p\.id\} ign=\{p\.ign\} \/>/);
  assert.match(board, /api\.get<UtilityProfile>\(`\/players\/\$\{userId\}\/utility`\)/);
  assert.match(board, /<BarChart height=\{190\}/);
  assert.match(board, /hasn't added any games yet/);
  assert.doesNotMatch(players, /only you and staff see these/);
});

test("linked account card and alert cards use the shared designs; IGNs stay Ign", () => {
  assert.match(players, /return l\?\.linked \? <LinkedAccountCard link=\{l\} \/> : null;/);
  assert.match(board, /<div className="mlbb-link__name"><Ign text=\{link\.name \|\| "MLBB account"\} \/><\/div>/);
  assert.match(board, /aria-label=\{`Copy game ID \$\{id\}`\}/);
  assert.match(perf, /<li className=\{`card focus-card \$\{t\.card\}`\} data-tone=\{tone\}/);
  assert.match(perf, /<div className="focus-card__tip"><ArrowRight/);
  for (const sel of [".board-row {", ".podium-card {", ".focus-card {", ".mlbb-link {", ".utility-tiles {"]) assert.ok(css.includes(sel), sel);
  // No player-facing AI wording in the leaderboard or Utility panel.
  assert.doesNotMatch(board.replace(/\/\*[\s\S]*?\*\//g, ""), /\bAI\b/);
});

test("IGN symbols (⚝) resolve to the bundled symbol font first, so they never show as a box", () => {
  const rule = css.match(/\.ign \{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /font-family: "Noto Sans Symbols", "Noto Sans Symbols 2", system-ui,/);
});
