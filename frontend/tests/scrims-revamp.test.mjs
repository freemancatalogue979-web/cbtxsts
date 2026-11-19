import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (p) => readFile(new URL(`../src/${p}`, import.meta.url), "utf8");
const page = await read("pages/Scrims.tsx");
const insights = await read("components/ScrimInsights.tsx");
const tournaments = await read("pages/Tournaments.tsx");
const tStats = await read("components/TournamentStats.tsx");

test("scrims open on an overview of charts fed by /scrims/insights", () => {
  assert.match(page, /useState\("overview"\)/);
  assert.match(page, /\/scrims\/insights/);
  assert.match(page, /<ScrimOverview data=\{insights\}/);
  for (const chart of ["LineChart", "BarChart", "VersusBars", "Ring", "HBars", "FormStrip"]) assert.match(insights, new RegExp(`<${chart}\\b`));
});

test("lineup card has lane colours, avatars and IGNs; subs are chips", () => {
  assert.match(page, /<LineupCard /);
  assert.match(insights, /scrim-lineup__row" data-lane=\{lane\}/);
  assert.match(insights, /<AvatarImg /);
  assert.match(insights, /<Ign text=\{u \? u\.ign \|\| u\.name/);
});

test("every player name on scrims and tournaments wears the IGN look", () => {
  // Both pages show who played through the shared two-team scoreboard.
  assert.match(page, /<MatchLineup theirLabel=\{opponent \|\| "Enemy"\} players=\{g\.players\}/);
  assert.match(tournaments, /<MatchLineup theirLabel=\{match\.opponent \|\| "Enemy"\} players=\{game\.players\}/);
  assert.match(tStats, /<Ign text=\{p\.name\}/);
});

test("a missing scrim says so instead of spinning forever", () => {
  assert.match(page, /That scrim isn't here/);
});

test("who played: both teams as scoreboards, IGNs, lane badges, ratings, MVP and kill share", async () => {
  const lineup = await readFile(new URL("../src/components/MatchLineup.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(lineup, /r\.name \? <Ign text=\{r\.name\} \/>/);
  assert.match(lineup, /name: enemyStats\?\.\[lane\]\?\.name, hero: enemyStats\?\.\[lane\]\?\.hero \|\| enemyPicks\?\.\[lane\]/);
  assert.match(lineup, /lineup__rating--\$\{ratingTier\(l\.rating\)\}/);
  assert.match(lineup, /<span className="lineup__vs" aria-hidden>vs<\/span>/);
  // Side by side only when the card is wide enough; phones stack the teams.
  assert.match(css, /\.lineup-wrap \{ container-type: inline-size; \}/);
  assert.match(css, /@container \(min-width: 620px\) \{\n  \.lineup \{ grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\);/);
  assert.match(css, /\.lineup__name \{ display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
  assert.match(css, /html\[data-effects="calm"\] \.lineup__bar/);
});
