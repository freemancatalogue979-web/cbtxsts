import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [perf, players, dashboard, scrims, stats] = await Promise.all([
  read("../src/components/PlayerPerformance.tsx"),
  read("../src/pages/Players.tsx"),
  read("../src/pages/Dashboard.tsx"),
  read("../src/pages/Scrims.tsx"),
  read("../src/components/TournamentStats.tsx"),
]);

test("the player page shows scrim + tournament games and the heroes to work on", () => {
  assert.match(players, /<PerformancePanel perf=\{p\.performance\} ign=\{p\.ign\} isSelf=\{p\.is_self\} \/>/);
  assert.match(perf, /label="Scrim games"/);
  assert.match(perf, /label="Tournament games"/);
  assert.match(perf, /isSelf \? "Heroes to work on" : <>Heroes <Ign text=\{ign\} \/> should work on<\/>/);
  assert.match(perf, /<HeroPerformance heroes=\{perf\.heroes\} \/>/);
});

test("every hero pool card says how many team games were played on it", () => {
  assert.match(players, /\{e\.played && <PoolPlayedLine played=\{e\.played\} alert=\{focusByHero\.get\(e\.hero_name\)\} \/>\}/);
  assert.match(players, /<span className="font-extrabold">\{played\.games\}<\/span> team \{played\.games === 1 \? "game" : "games"\}/);
});

test("the dashboard alerts players about their heroes and gives staff the squad list", () => {
  assert.match(dashboard, /\{dash\.my_form && <MyForm form=\{dash\.my_form\} \/>\}/);
  assert.match(dashboard, /<div className="label mb-2">Heroes to work on<\/div>/);
  assert.match(dashboard, /dash\.squad_focus\.length > 0 && <SquadFocus rows=\{dash\.squad_focus\} \/>/);
});

test("alerts keep fixed colours: losses red, warnings amber, strengths green — never the area accent", () => {
  assert.match(perf, /bad: \{ card: "border-danger\/45"/);
  assert.match(perf, /warn: \{ card: "border-amber\/45"/);
  assert.match(perf, /good: \{ card: "border-leaf\/45"/);
  const tones = perf.slice(perf.indexOf("const TONE"), perf.indexOf("export function kdaText"));
  assert.doesNotMatch(tones, /crim/);
});

test("scrim games record who played, each player's scoreboard line and the draft", () => {
  assert.match(scrims, /aria-label=\{`\$\{nice\(lane\)\} player, game \$\{f\.game_no\}`\}/);
  assert.match(scrims, /<ScoreboardFields form=\{lines\} onChange=\{setLines\} heroes=\{draft\.our_picks \?\? \{\}\} side="ours"/);
  assert.match(scrims, /<DraftBoardEditor heroes=\{heroes\} value=\{draft\}/);
  assert.match(scrims, /lineup: sameAsScrim \? \{\} : cleanLineup,/, "a game matching the booked lineup keeps following the scrim");
  assert.match(scrims, /\{ id: "players", label: "Player stats" \}/);
  assert.match(scrims, /<TournamentStats stats=\{stats\} kind="scrim"/);
  assert.match(stats, /\{hasKda && <th/);
  assert.match(stats, /\{hasRating && <th/);
});
