import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Keep display helpers usable on incomplete source records without a browser.
const source = await readFile(new URL("../src/lib/esports.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { esportsDate, esportsNumber, teamName, teamCode, gameDuration } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("unknown dates and statistics are never rendered as zero", () => {
  assert.equal(esportsDate(null), "Date TBC");
  assert.equal(esportsDate("not-a-date"), "Date TBC");
  assert.equal(esportsNumber(null), "—");
  assert.equal(esportsNumber(NaN), "—");
  assert.equal(esportsNumber(Infinity), "—");
  assert.equal(esportsNumber(0), "0");
});

test("match centre exposes playoff filtering and a bounded load-more control", async () => {
  const page = await readFile(new URL("../src/pages/Esports.tsx", import.meta.url), "utf8");
  assert.match(page, /aria-label="Match stage"/);
  assert.match(page, /item === "playoffs".*setView\("all"\)/);
  assert.match(page, /hasMoreMatches && matchLimit < 500/);
  assert.match(page, /Load more matches/);
  assert.match(page, /Source-labelled playoff/);
});

test("team and game displays fall back explicitly", () => {
  assert.equal(teamName({}), "To be decided");
  assert.equal(teamCode({}), "TBD");
  assert.equal(teamName({ teamCode: "ONIC" }), "ONIC");
  assert.equal(teamCode({ teamName: "Team Falcons" }), "Team Falcons");
  assert.equal(gameDuration(null), "—");
  assert.equal(gameDuration(0), "0:00");
  assert.equal(gameDuration(847), "14:07");
});
