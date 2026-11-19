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
  assert.match(page, /<Ign text=\{g\.players\[lane\]\}/);
  assert.match(tournaments, /<Ign text=\{game\.players!\[lane\]\}/);
  assert.match(tStats, /<Ign text=\{p\.name\}/);
});

test("a missing scrim says so instead of spinning forever", () => {
  assert.match(page, /That scrim isn't here/);
});
